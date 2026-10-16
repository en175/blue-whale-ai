import { type VideoRefRole } from '@/custom/enums';
import { useEffect, useRef } from 'react';
import type { CanvasDoc } from '@/custom/api/canvas';
import { linkAssetToProject, type UploadCompleteData } from '@/custom/api/assets';
import { takeGenHandoff, type GenHandoff } from '@/custom/utils/gen-handoff';
import type { VideoGenSeedParams } from '../components/BottomDialog';
import { isFrameMode } from '@/custom/utils/video-modes';

import { fetchUrlAsFile } from '../canvasPureNodeHelpers';
import { buildImageJobReferences, buildVideoJobReferencesFromList } from '../tools/video/videoJobReferences';
import type { CanvasGenerationSubmissionHandles } from './useCanvasGenerationSubmission';

export interface CanvasHomeHandoffHost {
  currentId: string | null;
  doc: CanvasDoc | null;
  activeProjectRef: { current: string | null };
  navigate: (path: string, options: { replace: boolean; state: null }) => void;
  location: { pathname: string; search: string; state: unknown };
  openImageFromHandoff: (params: { modelId?: string; ratio?: string; size?: string }) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  uploadFileToAsset: (file: File, type: 'image' | 'video' | 'audio') => Promise<UploadCompleteData | null>;
  createVideoDraftCard: (
    seed?: { modelId?: string; ratio?: string; size?: string; duration?: number; mode?: string; generateAudio?: boolean },
    position?: { x: number; y: number },
    overrides?: { recordHistory?: boolean },
  ) => string;
  openVideoDraftDialog: (nodeId: string, preset?: VideoGenSeedParams) => void;
  startGenerationJob: CanvasGenerationSubmissionHandles['startGenerationJob'];
}

export interface CanvasHomeHandoffHandles {
  firePendingGen: () => void;
  firePendingVideoDraft: () => void;
}

export function useCanvasHomeHandoff(host: CanvasHomeHandoffHost): CanvasHomeHandoffHandles {
  const {
    currentId,
    doc,
    activeProjectRef,
    navigate,
    location,
    openImageFromHandoff,
    showToast,
    uploadFileToAsset,
    createVideoDraftCard,
    openVideoDraftDialog,
    startGenerationJob,
  } = host;
  const pendingGenRef = useRef<GenHandoff | null>(null);
  const pendingVideoDraftSeedRef = useRef<VideoGenSeedParams | null>(null);

  const firePendingGen = () => {
    const handoff = pendingGenRef.current;
    if (!handoff) return;
    if (!currentId) return;
    if (!doc) return;
    pendingGenRef.current = null;
    const projectId = currentId;
    (async () => {
      const items = handoff.kind === 'image'
        ? handoff.files.map(f => ({ url: f.url, name: f.name, mediaType: 'image' as const, file: f.file, assetId: f.assetId, role: 'reference' as VideoRefRole }))
        : handoff.refs.map((r, i) => ({ url: r.preview, name: r.file?.name ?? `参考${i + 1}`, mediaType: r.type, file: r.file, assetId: r.assetId,
            role: (isFrameMode(handoff.mode) ? (i === 0 ? 'first' : 'last') : 'reference') as VideoRefRole }));
      const references: Array<{
        assetId: string;
        url: string;
        name: string;
        mediaType: 'image' | 'video';
        role: VideoRefRole;
        materialId?: string;
      }> = [];
      try {
        for (const item of items) {
          let assetId = item.assetId == null ? undefined : String(item.assetId);
          let url = item.url;
          if (!assetId) {
            const file = item.file ?? await fetchUrlAsFile(url, item.name, item.mediaType);
            const uploaded = file ? await uploadFileToAsset(file, item.mediaType) : null;
            if (!uploaded) {
              showToast('error', '参考素材上传失败，请重新发送');
              return;
            }
            assetId = uploaded.asset_id;
            url = uploaded.url;
          }
          await linkAssetToProject(projectId, assetId);
          references.push({ assetId, url, name: item.name, mediaType: item.mediaType, role: item.role });
        }
        if (activeProjectRef.current !== projectId) return;
        if (handoff.kind === 'image') {
          const jobRefs = buildImageJobReferences(references.map(r => r.assetId));
          startGenerationJob('image', { prompt: handoff.text, model_id: handoff.modelId, aspect_ratio: handoff.ratio, size: handoff.size },
            undefined, jobRefs.length > 0 ? { references: jobRefs } : undefined, undefined, { references });
        } else {
          startGenerationJob('video', { prompt: handoff.text, model_id: handoff.modelId, aspect_ratio: handoff.aspectRatio,
            resolution: handoff.resolution, duration: handoff.duration, mode: handoff.mode,
            generate_audio: handoff.generateAudio }, undefined,
            { references: buildVideoJobReferencesFromList(references) },
            undefined, { references, mode: handoff.mode });
        }
      } catch (error) {
        console.warn('首页生成参考准备失败:', error);
        showToast('error', '参考素材准备失败，请重新发送');
      } finally {
        items.forEach(item => { if (item.file) URL.revokeObjectURL(item.url); });
      }
    })();
    navigate(location.pathname + location.search, { replace: true, state: null });
  };
  const firePendingVideoDraft = () => {
    const seed = pendingVideoDraftSeedRef.current;
    if (!seed) return;
    if (!currentId) return;
    if (!doc) return;
    pendingVideoDraftSeedRef.current = null;
    const nodeId = createVideoDraftCard({
      modelId: seed.modelId,
      ratio: seed.aspectRatio,
      size: seed.resolution,
      duration: seed.duration,
      mode: seed.mode,
      generateAudio: seed.generateAudio,
    }, undefined, { recordHistory: true });
    openVideoDraftDialog(nodeId, seed);
  };

  useEffect(() => {
    const state = location.state as { genKind?: 'video' | 'image' } | null;
    if (!state?.genKind) return;
    const handoff = takeGenHandoff();
    if (!handoff) {
      navigate(location.pathname + location.search, { replace: true, state: null });
      return;
    }
    if (handoff.kind === 'video') {
      pendingVideoDraftSeedRef.current = {
        modelId: handoff.modelId,
        aspectRatio: handoff.aspectRatio,
        resolution: handoff.resolution,
        duration: handoff.duration,
        mode: handoff.mode,
        generateAudio: handoff.generateAudio,
      };
    } else {
      openImageFromHandoff({
        modelId: handoff.modelId,
        ratio: handoff.ratio,
        size: handoff.size,
      });
    }
    pendingGenRef.current = handoff;
    firePendingGen();
    firePendingVideoDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);

  useEffect(() => {
    firePendingGen();
    firePendingVideoDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, doc]);

  return { firePendingGen, firePendingVideoDraft };
}
