import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'crypto';
import * as Y from 'yjs';
import { Request } from 'express';
import { WebSocket } from 'ws';
import { Server, Hocuspocus } from '@hocuspocus/server';
import { MINIO_INTERNAL } from '@/common/minio.service';
import { MinioService } from '@/common/minio.service';
import { RAGService } from '@/rag/rag.service';
import { Prisma } from '@prisma/client';
import { User } from '@refly-packages/openapi-schema';
import { SubscriptionService } from '@/subscription/subscription.service';
import { MiscService } from '@/misc/misc.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/common/redis.service';
import { ElasticsearchService } from '@/common/elasticsearch.service';
import { PrismaService } from '@/common/prisma.service';
import { IDPrefix, incrementalMarkdownUpdate, state2Markdown } from '@refly-packages/utils';
import { streamToBuffer } from '@/utils/stream';
import { CollabContext, isCanvasContext, isDocumentContext } from './collab.dto';
import { Redis } from '@hocuspocus/extension-redis';
import { QUEUE_SYNC_CANVAS_ENTITY } from '@/utils/const';
import ms from 'ms';

@Injectable()
export class CollabService {
  private logger = new Logger(CollabService.name);
  private server: Hocuspocus;

  constructor(
    private rag: RAGService,
    private prisma: PrismaService,
    private redis: RedisService,
    private elasticsearch: ElasticsearchService,
    private config: ConfigService,
    private miscService: MiscService,
    private subscriptionService: SubscriptionService,
    @Inject(MINIO_INTERNAL) private minio: MinioService,
    @InjectQueue(QUEUE_SYNC_CANVAS_ENTITY) private canvasQueue: Queue,
  ) {
    this.server = Server.configure({
      port: this.config.get<number>('wsPort'),
      onAuthenticate: (payload) => this.authenticate(payload),
      onLoadDocument: (payload) => this.loadDocument(payload),
      onStoreDocument: (payload) => this.storeDocument(payload),
      afterUnloadDocument: async (payload) => {
        this.logger.log(`afterUnloadDocument ${payload.documentName}`);
      },
      onDisconnect: async (payload) => {
        this.logger.log(`onDisconnect ${payload.documentName}`);
      },
      extensions: [new Redis({ redis: this.redis })],
    });
  }

  handleConnection(connection: WebSocket, request: Request) {
    this.server.handleConnection(connection, request);
  }

  async signCollabToken(user: User) {
    const token = randomUUID();
    const tokenExpiry = ms(String(this.config.get('auth.collab.tokenExpiry')));
    const expiresAt = Date.now() + tokenExpiry;
    await this.redis.setex(`collab:token:${token}`, tokenExpiry / 1000, user.uid);

    return { token, expiresAt };
  }

  private async validateCollabToken(token: string): Promise<string | null> {
    return this.redis.get(`collab:token:${token}`);
  }

  async authenticate({ token, documentName }: { token: string; documentName: string }) {
    // First validate the token from Redis
    const uid = await this.validateCollabToken(token);
    if (!uid) {
      throw new Error('Invalid or expired collab token');
    }

    const user = await this.prisma.user.findFirst({
      where: { uid },
    });
    if (!user) {
      throw new Error(`user not found`);
    }

    let context: CollabContext;
    if (documentName.startsWith(IDPrefix.DOCUMENT)) {
      let doc = await this.prisma.document.findFirst({
        where: { docId: documentName, deletedAt: null },
      });
      if (!doc) {
        doc = await this.prisma.document.create({
          data: {
            docId: documentName,
            uid: user.uid,
            title: '',
          },
        });
        this.logger.log(`document created: ${documentName}`);

        await this.subscriptionService.syncStorageUsage({
          uid: user.uid,
          timestamp: new Date(),
        });
      }
      context = { user, entity: doc, entityType: 'document' };
    } else if (documentName.startsWith(IDPrefix.CANVAS)) {
      let canvas = await this.prisma.canvas.findFirst({
        where: { canvasId: documentName, deletedAt: null },
      });
      if (!canvas) {
        canvas = await this.prisma.canvas.create({
          data: {
            canvasId: documentName,
            uid: user.uid,
            title: '',
          },
        });
        this.logger.log(`canvas created: ${documentName}`);
      }
      context = { user, entity: canvas, entityType: 'canvas' };
    } else {
      throw new Error(`unknown document name: ${documentName}`);
    }

    if (context.entity.uid !== user.uid) {
      throw new Error(`user not authorized: ${documentName}`);
    }

    this.logger.log(`document connected: ${documentName}`);

    // Set contextual data to use it in other hooks
    return context;
  }

  async loadDocument({
    document,
    documentName,
    context,
  }: {
    document: Y.Doc;
    documentName: string;
    context: CollabContext;
  }) {
    const { entity } = context;
    const { stateStorageKey } = entity;

    if (!stateStorageKey) {
      this.logger.warn(`stateStorageKey not found for ${documentName}`);
      return null;
    }

    try {
      const readable = await this.minio.client.getObject(stateStorageKey);
      const state = await streamToBuffer(readable);
      Y.applyUpdate(document, state);

      const title = document.getText('title')?.toJSON();
      if (!title) {
        document.getText('title').insert(0, entity.title);
      }
    } catch (err) {
      this.logger.error(`fetch state failed for ${stateStorageKey}, err: ${err.stack}`);
      return null;
    }
  }

  private async storeDocumentEntity({
    state,
    document,
    context,
  }: {
    state: Buffer;
    document: Y.Doc;
    context: Extract<CollabContext, { entityType: 'document' }>;
  }) {
    const { user, entity: doc } = context;

    if (!doc) {
      this.logger.warn(`document is empty for context: ${JSON.stringify(context)}`);
      return;
    }

    const title = document.getText('title').toJSON();

    const content = state2Markdown(state);
    const storageKey = doc.storageKey || `doc/${doc.docId}.txt`;
    const stateStorageKey = doc.stateStorageKey || `state/${doc.docId}`;

    // Save content and ydoc state to object storage
    await Promise.all([
      this.minio.client.putObject(storageKey, content),
      this.minio.client.putObject(stateStorageKey, state),
    ]);

    // Prepare document updates
    const docUpdates: Prisma.DocumentUpdateInput = {};
    if (!doc.storageKey) {
      docUpdates.storageKey = storageKey;
    }
    if (!doc.stateStorageKey) {
      docUpdates.stateStorageKey = stateStorageKey;
    }
    if (doc.contentPreview !== content.slice(0, 500)) {
      docUpdates.contentPreview = content.slice(0, 500);
    }
    if (doc.title !== title) {
      docUpdates.title = title;
    }

    // Re-calculate storage size
    const [storageStat, stateStorageStat] = await Promise.all([
      this.minio.client.statObject(storageKey),
      this.minio.client.statObject(stateStorageKey),
    ]);
    docUpdates.storageSize = storageStat.size + stateStorageStat.size;

    // Re-index content to elasticsearch and vector store
    const [, { size }] = await Promise.all([
      this.elasticsearch.upsertDocument({
        id: doc.docId,
        content,
        title,
        uid: doc.uid,
        updatedAt: new Date().toJSON(),
      }),
      this.rag.indexDocument(user, {
        pageContent: content,
        metadata: {
          nodeType: 'document',
          title: doc.title,
          docId: doc.docId,
        },
      }),
    ]);
    docUpdates.vectorSize = size;

    const updatedDoc = await this.prisma.document.update({
      where: { docId: doc.docId },
      data: docUpdates,
    });
    context.entity = updatedDoc;

    // Vacuum unused files
    // const staticPrefix = this.config.get('staticEndpoint');
    // const fileKeys = content
    //   .match(new RegExp(`${staticPrefix}([^)]+)`, 'g'))
    //   ?.map((match) => match.slice(staticPrefix.length));
    // await this.miscService.compareAndRemoveFiles(user, {
    //   entityId: note.noteId,
    //   entityType: 'note',
    //   objectKeys: fileKeys,
    // });
  }

  private async storeCanvasEntity({
    state,
    document,
    context,
  }: {
    state: Buffer;
    document: Y.Doc;
    context: Extract<CollabContext, { entityType: 'canvas' }>;
  }) {
    const { user, entity: canvas } = context;

    if (!canvas) {
      this.logger.warn(`canvas is empty for context: ${JSON.stringify(context)}`);
      return;
    }

    const stateStorageKey = canvas.stateStorageKey || `state/${canvas.canvasId}`;
    await this.minio.client.putObject(stateStorageKey, state);

    const title = document.getText('title').toJSON();

    const stateStorageStat = await this.minio.client.statObject(stateStorageKey);

    const canvasUpdates: Prisma.CanvasUpdateInput = {
      storageSize: stateStorageStat.size,
    };
    if (!canvas.stateStorageKey) {
      canvasUpdates.stateStorageKey = stateStorageKey;
    }
    if (canvas.title !== title) {
      canvasUpdates.title = title;
    }
    this.logger.log(`canvas ${canvas.canvasId} updates: ${JSON.stringify(canvasUpdates)}`);

    const updatedCanvas = await this.prisma.canvas.update({
      where: { canvasId: canvas.canvasId, uid: user.uid },
      data: canvasUpdates,
    });
    context.entity = updatedCanvas;

    await this.elasticsearch.upsertCanvas({
      id: canvas.canvasId,
      title,
      uid: canvas.uid,
      updatedAt: new Date().toJSON(),
    });

    // Add sync canvas entity job with debouncing
    await this.canvasQueue.add(
      'syncCanvasEntity',
      { canvasId: canvas.canvasId },
      {
        jobId: canvas.canvasId, // Use consistent jobId for deduplication
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async storeDocument({ document, context }: { document: Y.Doc; context: CollabContext }) {
    const state = Buffer.from(Y.encodeStateAsUpdate(document));

    if (isDocumentContext(context)) {
      return this.storeDocumentEntity({ state, document, context });
    } else if (isCanvasContext(context)) {
      return this.storeCanvasEntity({ state, document, context });
    } else {
      this.logger.warn(`unknown context entity type: ${JSON.stringify(context)}`);
      return null;
    }
  }

  async openDirectConnection(documentName: string, context?: CollabContext) {
    return this.server.openDirectConnection(documentName, context);
  }

  async modifyDocument(documentName: string, update: string) {
    const { document } = await this.server.openDirectConnection(documentName);
    incrementalMarkdownUpdate(document, update);
  }
}
