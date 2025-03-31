import { useSiderStoreShallow } from '@refly-packages/ai-workspace-common/stores/sider';
import { Divider, Layout } from 'antd';
import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  useGetProjectDetail,
  useListResources,
  useListDocuments,
} from '@refly-packages/ai-workspace-common/queries';
import { Document, Resource } from '@refly/openapi-schema';
import { CanvasMenu } from '@refly-packages/ai-workspace-common/components/project/canvas-menu';
import { SourcesMenu } from '@refly-packages/ai-workspace-common/components/project/source-menu';
import { ProjectSettings } from '@refly-packages/ai-workspace-common/components/project/project-settings';
import cn from 'classnames';
import './index.scss';
import { useHandleSiderData } from '@refly-packages/ai-workspace-common/hooks/use-handle-sider-data';
import { useGetProjectCanvasId } from '@refly-packages/ai-workspace-common/hooks/use-get-project-canvasId';
import { useNavigate } from 'react-router-dom';

export const iconClassName = 'w-4 h-4 flex items-center justify-center';
export interface sourceObject extends Document, Resource {
  entityType: 'document' | 'resource';
  entityId: string;
}

interface ProjectDirectoryProps {
  projectId: string;
  source: 'sider' | 'popover';
}

export const ProjectDirectory = ({ projectId, source }: ProjectDirectoryProps) => {
  const { getCanvasList, updateCanvasList, isLoadingCanvas } = useHandleSiderData(true);
  const { canvasId } = useGetProjectCanvasId();
  const navigate = useNavigate();
  const { collapse, setCollapse, canvasList } = useSiderStoreShallow((state) => ({
    canvasList: state.canvasList,
    collapse: state.collapse,
    setCollapse: state.setCollapse,
  }));

  const { data: projectDetail } = useGetProjectDetail({ query: { projectId } }, null, {
    enabled: !!projectId,
  });
  const data = projectDetail?.data;
  const [projectData, setProjectData] = useState(data);

  const {
    data: documentsResponse,
    refetch: refetchDocuments,
    isFetching: isFetchingDocuments,
  } = useListDocuments({ query: { projectId, page: 1, pageSize: 1000 } }, null, {
    enabled: !!projectId,
  });

  const {
    data: resourcesResponse,
    refetch: refetchResources,
    isFetching: isFetchingResources,
  } = useListResources({ query: { projectId, page: 1, pageSize: 1000 } }, null, {
    enabled: !!projectId,
  });

  const documents = documentsResponse?.data || [];
  const resources = resourcesResponse?.data || [];

  const mergedSources = useMemo(() => {
    const docs = (documents || []).map((item) => ({
      ...item,
      entityId: item.docId,
      entityType: 'document',
    }));
    const res = (resources || []).map((item) => ({
      ...item,
      entityId: item.resourceId,
      entityType: 'resource',
    }));

    const merged = [...docs, ...res];

    return merged.sort((a, b) => {
      const dateA = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });
  }, [documents, resources]);

  const refetchFiles = useCallback(() => {
    Promise.all([refetchDocuments(), refetchResources()]);
  }, [refetchDocuments, refetchResources]);

  const handleRemoveCanvases = useCallback(
    async (canvasIds: string[]) => {
      const newCanvasList = canvasList.filter((item) => !canvasIds.includes(item.id));
      updateCanvasList(newCanvasList);
      if (canvasIds.includes(canvasId)) {
        const newCanvasId = newCanvasList.length > 0 ? newCanvasList[0].id : 'empty';
        navigate(`/project/${projectId}?canvasId=${newCanvasId}`);
      }
    },
    [updateCanvasList, canvasId, canvasList, navigate, projectId],
  );

  const handleAddCanvases = useCallback(
    async (canvasIds: string[]) => {
      getCanvasList(true);
      if (canvasIds?.[0]) {
        navigate(`/project/${projectId}?canvasId=${canvasIds[0]}`);
      }
    },
    [getCanvasList, navigate, projectId],
  );

  useEffect(() => {
    setProjectData(data);
  }, [data]);

  return (
    <Layout.Sider
      width={source === 'sider' ? (collapse ? 0 : 220) : 220}
      className={cn(
        'border border-solid border-gray-100 bg-white shadow-sm',
        source === 'sider' ? 'h-[calc(100vh)]' : 'h-[calc(100vh-100px)] rounded-r-lg',
      )}
    >
      <div className="project-directory flex h-full flex-col py-3 overflow-y-auto">
        <ProjectSettings
          source={source}
          setCollapse={setCollapse}
          data={projectData}
          onUpdate={(data) => {
            setProjectData({ ...projectData, ...data });
          }}
        />

        <Divider className="my-2" />

        <CanvasMenu
          isFetching={isLoadingCanvas}
          canvasList={canvasList}
          projectId={projectId}
          onAddCanvasesSuccess={handleAddCanvases}
          onRemoveCanvases={handleRemoveCanvases}
        />
        <SourcesMenu
          isFetching={isFetchingDocuments || isFetchingResources}
          sourceList={mergedSources as sourceObject[]}
          projectId={projectId}
          documentCount={documents?.length || 0}
          resourceCount={resources?.length || 0}
          onUpdatedItems={() => {
            refetchFiles();
          }}
        />
      </div>
    </Layout.Sider>
  );
};
