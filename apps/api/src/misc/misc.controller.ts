import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Param,
  StreamableFile,
  Header,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/auth/guard/jwt-auth.guard';
import { MiscService } from '@/misc/misc.service';
import {
  ScrapeWeblinkRequest,
  ScrapeWeblinkResponse,
  UploadRequest,
  UploadResponse,
} from '@refly/openapi-schema';
import { buildSuccessResponse } from '@/utils';
import { User as UserModel } from '@prisma/client';
import { User } from '@/utils/decorators/user.decorator';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('misc')
export class MiscController {
  constructor(private readonly miscService: MiscService) {}

  @UseGuards(JwtAuthGuard)
  @Post('scrape')
  async scrapeWeblink(@Body() body: ScrapeWeblinkRequest): Promise<ScrapeWeblinkResponse> {
    const result = await this.miscService.scrapeWeblink(body);
    return buildSuccessResponse(result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadStaticFile(
    @User() user: UserModel,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadRequest,
  ): Promise<UploadResponse> {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    const result = await this.miscService.uploadFile(
      user,
      {
        file,
        entityId: body.entityId,
        entityType: body.entityType,
      },
      { checkEntity: true, checkStorageQuota: true },
    );
    return buildSuccessResponse(result);
  }

  @Get('static/:objectKey')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async serveStatic(
    @Param('objectKey') objectKey: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const fileStream = await this.miscService.getFileStream(objectKey);

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="${objectKey}"`,
    });

    return fileStream;
  }
}
