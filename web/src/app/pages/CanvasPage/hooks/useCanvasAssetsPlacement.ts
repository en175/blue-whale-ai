import type { Dispatch, SetStateAction, RefObject } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { linkAssetToProject, type AssetRecord } from '@/app/api/assets';
import type { SessionContentBlock } from '@/app/api/agentSessions';
import { refOverflowToast } from '@/app/utils/ref-overflow';
import {
  VIDEO_REFERENCE_NOT_APPROVED_MESSAGE,
  isUnapprovedVideoMaterialStatus,
} from '@/app/utils/video-reference-compliance';
import type { UploadedFile } from '../components/ImageDialog';
import type { AudioRefItem } from '../components/AudioDialog';
import type { MediaDims } from '../components/MediaNode/mediaContentSize';
import { assetDisplayName } from '../canvasPureNodeHelpers';
import { newNodeId } from '../nodeId';
import { baseSourceError, imageMediaRefsOf, isMaterialLibraryId, readAssetId } from '../mediaRefs';
import {
  asVideoRefMediaType,
  mergedVideoMediaRefsOf,
  occupiedVideoRefIds,
  type VideoMediaRef,
  type VideoMediaRefs,
  type VideoRefRole,
} from '../videoMediaRefs';
import { audioRefItemMediaTypeOf, checkAddAudioRef } from '../audioMediaRefs';
import { mergedAudioRefsWithTextIndex } from '../textIndexSync';
import { importLivenessLibraryAssets, isPendingLivenessLibraryAsset } from '../livenessLibraryImport';
import type { CanvasNodeActions } from './useCanvasNodeFactories';

export interface CanvasAssetsPlacementHost {
  currentId: string;
  toolMode: string;
  mediaNodesRef: RefObject<Node[]>;
  textNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  actionsRef: RefObject<CanvasNodeActions>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  spawnPosition: () => { x: number; y: number };
  dockToolCallbacks: Record<string, unknown>;
  handleMediaDims: (id: string, dims: MediaDims) => void;
  handleSaveMediaToAssets: (id: string) => void;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole) => void;
  validateVideoRefConnect: (source: string, target: string, role?: VideoRefRole) => boolean;
  videoCapsOfDraft: (id: string | null) => { imageMax?: number; videoReferenceMax?: number; audioReferenceMax?: number } | null;
  imageRefMaxOfDraft: (id: string) => number;
  videoFreeRefs: VideoMediaRefs;
  appendVideoFreeRef: (item: VideoMediaRef, role: VideoRefRole) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;

  assetsPickerTarget: 'toolbar' | 'videoDraft' | 'imageDialog' | 'audioDialog' | 'agentPanel';
  setShowAssetsPicker: (v: boolean) => void;
  videoAssetPickRole: VideoRefRole;
  videoDraftId: string | null;
  audioDraftId: string | null;
  audioAssetPickTarget: { nodeId: string | null; seed: number | undefined } | null;
  audioSeed: { ts: number } | null;
  isGeneratingNode: (id: string) => boolean;
  imageDraftId: string | null;
  showAudioDialog: boolean;

  setAudioAssetPickResult: Dispatch<SetStateAction<{ ts: number; items: AudioRefItem[] } | null>>;
  setImagePickResult: Dispatch<SetStateAction<{ ts: number; files: UploadedFile[] } | null>>;
  setAgentAssetPicks: Dispatch<SetStateAction<{ ts: number; blocks: SessionContentBlock[] } | null>>;
}

export interface CanvasAssetsPlacementHandles {
  placeAssetsOnCanvas: (selectedAssets: AssetRecord[], opts?: { reuseExisting?: boolean }) => string[] | null;
  handleAssetsPickerSelect: (selectedAssets: AssetRecord[]) => Promise<void>;
}

export function useCanvasAssetsPlacement(host: CanvasAssetsPlacementHost): CanvasAssetsPlacementHandles {
  const {
    currentId,
    toolMode,
    mediaNodesRef,
    textNodesRef,
    edgesRef,
    pendingNodeIdsRef,
    actionsRef,
    setMediaNodes,
    spawnPosition,
    dockToolCallbacks,
    handleMediaDims,
    handleSaveMediaToAssets,
    addCanvasEdge,
    validateVideoRefConnect,
    videoCapsOfDraft,
    imageRefMaxOfDraft,
    videoFreeRefs,
    appendVideoFreeRef,
    showToast,
    assetsPickerTarget,
    setShowAssetsPicker,
    videoAssetPickRole,
    videoDraftId,
    audioDraftId,
    audioAssetPickTarget,
    audioSeed,
    isGeneratingNode,
    imageDraftId,
    showAudioDialog,
    setAudioAssetPickResult,
    setImagePickResult,
    setAgentAssetPicks,
  } = host;

  const placeAssetsOnCanvas = (
    selectedAssets: AssetRecord[],
    opts?: { reuseExisting?: boolean },
  ): string[] | null => {
    if (!currentId) return null;
    const adoptedIds: string[] = [];
    const nodes: Node[] = [];
    const reusedCompliance: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const complianceFromAsset = (asset: AssetRecord): Record<string, unknown> => {
      if (asset.type === 'audio') return {};
      const id = String(asset.id);
      const fromLibrary = isMaterialLibraryId(id);
      const materialId = fromLibrary
        ? id
        : (typeof asset.material_id === 'string' && asset.material_id ? asset.material_id : undefined);
      if (isUnapprovedVideoMaterialStatus(asset.material_status)) {
        return {
          ...(materialId ? { materialId } : {}),
          compliancePassed: false,
          complianceFailed: true,
        };
      }
      if (asset.material_status !== 'Active' && !fromLibrary) return {};
      if (fromLibrary && asset.material_status !== 'Active') {
        return materialId ? { materialId } : {};
      }
      return {
        ...(materialId ? { materialId } : {}),
        compliancePassed: true,
        complianceFailed: false,
      };
    };
    for (const asset of selectedAssets) {
      const assetId = String(asset.id);
      const mediaType = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image';
      if (opts?.reuseExisting) {
        const libraryId = typeof asset.material_id === 'string' && asset.material_id ? asset.material_id : undefined;
        const existing = mediaNodesRef.current.find(
          (n) => {
            if (n.type !== 'mediaNode') return false;
            const data = (n.data ?? {}) as Record<string, unknown>;
            if (data.mediaType !== mediaType || baseSourceError(n) !== null) return false;
            const nodeAssetId = readAssetId(data);
            if (nodeAssetId === assetId) return true;
            if (libraryId && (data.materialId === libraryId || nodeAssetId === libraryId)) return true;
            return false;
          },
        );
        if (existing) {
          const patch = complianceFromAsset(asset);
          if (Object.keys(patch).length > 0) reusedCompliance.push({ id: existing.id, patch });
          adoptedIds.push(existing.id);
          continue;
        }
      }
      const fileNameFromUrl = assetDisplayName(asset);
      const nodeId = newNodeId('media');
      nodes.push({
        id: nodeId,
        type: 'mediaNode' as const,
        position: spawnPosition(),
        data: {
          src: asset.url,
          fileName: fileNameFromUrl,
          mediaType,
          assetId,
          ...complianceFromAsset(asset),
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          duration: asset.duration ?? undefined,
          size: asset.size ?? undefined,
          toolMode,
          onDelete: (id: string) => {
            setMediaNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onDownload: (id: string) => actionsRef.current.download(id),
          ...dockToolCallbacks,
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
        },
      });
    }
    nodes.forEach((node) => pendingNodeIdsRef.current.add(node.id));
    setMediaNodes((prev) => {
      const patched = reusedCompliance.length === 0
        ? prev
        : prev.map((node) => {
            const hit = reusedCompliance.find((item) => item.id === node.id);
            return hit ? { ...node, data: { ...node.data, ...hit.patch } } : node;
          });
      return [...patched, ...nodes];
    });
    selectedAssets.forEach((asset) => {
      if (isMaterialLibraryId(String(asset.id))) return;
      linkAssetToProject(currentId, asset.id).catch((err) => {
        console.warn('资产关联项目失败：', err);
        showToast('warn', '资产关联项目失败，请稍后重试');
      });
    });
    return [...adoptedIds, ...nodes.map((n) => n.id)];
  };

  const handleAssetsPickerSelect = async (selectedAssets: AssetRecord[]) => {
    const target = assetsPickerTarget;
    setShowAssetsPicker(false);
    if (selectedAssets.length === 0) return;
    if (!currentId) {
      showToast('error', '项目未就绪，请稍后重试');
      return;
    }
    if (selectedAssets.some(isPendingLivenessLibraryAsset)) {
      showToast('warn', '正在导入真人人像库素材…');
    }
    const assets = await importLivenessLibraryAssets(selectedAssets, currentId, (name, message) => {
      showToast('error', `「${name}」${message}`);
    });
    if (assets.length === 0) return;
    if (target === 'videoDraft') {
      const role = videoAssetPickRole;
      const refs = videoDraftId
        ? mergedVideoMediaRefsOf(videoDraftId, edgesRef.current, mediaNodesRef.current)
        : videoFreeRefs;
      let accepted = assets.filter((a) => a.type === 'image' || a.type === 'video' || a.type === 'audio');
      const unapproved = accepted.filter((a) => isUnapprovedVideoMaterialStatus(a.material_status));
      if (unapproved.length > 0) {
        showToast('warn', VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
        accepted = accepted.filter((a) => !isUnapprovedVideoMaterialStatus(a.material_status));
        if (accepted.length === 0) return;
      }
      if (role === 'first' || role === 'last') {
        if (refs[role]) {
          showToast('warn', role === 'first' ? '首帧已指定，请先移除现有首帧' : '尾帧已指定，请先移除现有尾帧');
          return;
        }
        accepted = accepted.filter((a) => a.type === 'image');
        if (accepted.length === 0) return;
        const otherRole: VideoRefRole = role === 'first' ? 'last' : 'first';
        const frameRoles: VideoRefRole[] = refs[otherRole] ? [role] : [role, otherRole];
        if (accepted.length > frameRoles.length) {
          showToast('warn', frameRoles.length > 1
            ? '首尾帧最多两张图片，已按选择顺序取前两张'
            : '首尾帧仅支持一张图片，已取首张');
        }
        accepted = accepted.slice(0, frameRoles.length);
        if (!videoDraftId) {
          accepted.forEach((a, i) =>
            appendVideoFreeRef(
              {
                nodeId: `asset-${a.id}`,
                url: a.url,
                name: assetDisplayName(a),
                assetId: String(a.id),
                mediaType: asVideoRefMediaType(a.type),
                materialId: typeof a.material_id === 'string' && a.material_id
                  ? a.material_id
                  : (isMaterialLibraryId(String(a.id)) ? String(a.id) : undefined),
              },
              frameRoles[i] ?? role,
            ),
          );
          return;
        }
        for (let i = 0; i < accepted.length; i += 1) {
          const nodeIds = placeAssetsOnCanvas([accepted[i]!], { reuseExisting: true });
          if (!nodeIds) {
            showToast('error', '项目未就绪，请稍后重试');
            return;
          }
          if (validateVideoRefConnect(nodeIds[0]!, videoDraftId, frameRoles[i] ?? role)) {
            addCanvasEdge(nodeIds[0]!, videoDraftId, frameRoles[i] ?? role);
          }
        }
        return;
      }
      const caps = videoCapsOfDraft(videoDraftId);
      const imageMax = caps?.imageMax ?? 9;
      const videoMax = caps?.videoReferenceMax ?? 3;
      const audioMax = caps?.audioReferenceMax ?? 3;
      const known = occupiedVideoRefIds(refs);
      let imgSlots = imageMax - refs.reference.filter((r) => r.mediaType === 'image').length;
      let vidSlots = videoMax - refs.reference.filter((r) => r.mediaType === 'video').length;
      let audSlots = audioMax - refs.reference.filter((r) => r.mediaType === 'audio').length;
      const overflowKinds: Array<'image' | 'video' | 'audio'> = [];
      let skippedDup = false;
      const filtered: AssetRecord[] = [];
      for (const a of accepted) {
        const materialId = typeof a.material_id === 'string' && a.material_id ? a.material_id : undefined;
        if (known.has(String(a.id)) || (materialId && known.has(materialId))) {
          skippedDup = true;
          continue;
        }
        const isImage = a.type === 'image';
        const isVideo = a.type === 'video';
        if ((isImage && imgSlots <= 0) || (isVideo && vidSlots <= 0) || (!isImage && !isVideo && audSlots <= 0)) {
          overflowKinds.push(a.type as 'image' | 'video' | 'audio');
          continue;
        }
        if (isImage) imgSlots -= 1;
        else if (isVideo) vidSlots -= 1;
        else audSlots -= 1;
        known.add(String(a.id));
        if (materialId) known.add(materialId);
        filtered.push(a);
      }
      accepted = filtered;
      if (skippedDup) showToast('warn', '重复的素材已跳过');
      if (overflowKinds.length > 0) showToast('warn', refOverflowToast(overflowKinds, { image: imageMax, video: videoMax, audio: audioMax }));
      if (accepted.length === 0) return;
      if (!videoDraftId) {
        accepted.forEach((a) =>
          appendVideoFreeRef(
            {
              nodeId: `asset-${a.id}`,
              url: a.url,
              name: assetDisplayName(a),
              assetId: String(a.id),
              mediaType: asVideoRefMediaType(a.type),
              materialId: typeof a.material_id === 'string' && a.material_id
                ? a.material_id
                : (isMaterialLibraryId(String(a.id)) ? String(a.id) : undefined),
            },
            role,
          ),
        );
        return;
      }
        const nodeIds = placeAssetsOnCanvas(accepted, { reuseExisting: true });
        if (!nodeIds) {
          showToast('error', '项目未就绪，请稍后重试');
          return;
        }
        nodeIds.forEach((nid) => {
          if (validateVideoRefConnect(nid, videoDraftId, role)) {
            addCanvasEdge(nid, videoDraftId, role);
          }
        });
      return;
    }
    if (target === 'audioDialog') {
      if (!showAudioDialog || !audioAssetPickTarget || audioAssetPickTarget.nodeId !== audioDraftId
        || audioAssetPickTarget.seed !== audioSeed?.ts || (audioDraftId && isGeneratingNode(audioDraftId))) return;
      const mediaAssets = assets.filter(a => a.type === 'audio' || a.type === 'image');
      if (!audioDraftId) {
        setAudioAssetPickResult({ ts: Date.now(), items: mediaAssets.map(a => {
          const kind = audioRefItemMediaTypeOf({ kind: a.type });
          return {
          id: `asset-${a.id}`,
          kind,
          mediaType: kind,
          name: assetDisplayName(a), src: a.url,
          source: 'canvas' as const, assetId: a.id,
        }; }) });
        return;
      }
      const current = [...mergedAudioRefsWithTextIndex(
        audioDraftId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      ).refs];
      const accepted: AssetRecord[] = [];
      for (const asset of mediaAssets) {
        const id = String(asset.id);
        const incomingType = audioRefItemMediaTypeOf({ kind: asset.type });
        const error = checkAddAudioRef(id, current, 0, incomingType);
        if (error) { showToast('warn', error); continue; }
        current.push({ nodeId: `asset-${id}`, assetId: id, url: asset.url, name: assetDisplayName(asset), mediaType: incomingType });
        accepted.push(asset);
      }
      if (!accepted.length) return;
      const nodeIds = placeAssetsOnCanvas(accepted, { reuseExisting: true });
      if (!nodeIds) { showToast('error', '项目未就绪，请稍后重试'); return; }
      nodeIds.forEach(id => addCanvasEdge(id, audioDraftId));
      return;
    }
    if (target === 'imageDialog') {
      const images = assets.filter((a) => a.type === 'image');
      if (images.length === 0) return;
      if (imageDraftId) {
        const current = imageMediaRefsOf(imageDraftId, edgesRef.current, mediaNodesRef.current);
        const known = new Set(current.map((r) => r.assetId));
        const imageMax = imageRefMaxOfDraft(imageDraftId);
        const accepted: AssetRecord[] = [];
        let skippedDup = false;
        let overflow = false;
        for (const a of images) {
          const id = String(a.id);
          if (known.has(id)) { skippedDup = true; continue; }
          if (known.size >= imageMax) { overflow = true; break; }
          known.add(id);
          accepted.push(a);
        }
        if (skippedDup) showToast('warn', '重复的素材已跳过');
        if (overflow) showToast('warn', refOverflowToast(['image'], { image: imageMax }));
        if (accepted.length === 0) return;
        const nodeIds = placeAssetsOnCanvas(accepted, { reuseExisting: true });
        if (!nodeIds) {
          showToast('error', '项目未就绪，请稍后重试');
          return;
        }
        nodeIds.forEach((nid) => addCanvasEdge(nid, imageDraftId));
        return;
      }
      const files: UploadedFile[] = images
        .map((a) => ({ id: `asset-${a.id}`, url: a.url, type: 'image' as const, name: assetDisplayName(a), assetId: a.id }));
      setImagePickResult({ ts: Date.now(), files });
      return;
    }
    if (target === 'agentPanel') {
      if (!placeAssetsOnCanvas(assets)) {
        showToast('error', '项目未就绪，请稍后重试');
        return;
      }
      const blocks: SessionContentBlock[] = assets
        .filter((a) => a.type === 'image' || a.type === 'video')
        .map((a) => ({
          type: 'asset_ref',
          url: a.url,
          name: assetDisplayName(a),
          media_type: (a.type === 'video' ? 'video' : 'image') as 'image' | 'video',
          display_label: assetDisplayName(a),
          asset_id: String(a.id),
        }));
      if (blocks.length > 0) setAgentAssetPicks({ ts: Date.now(), blocks });
      return;
    }
    if (!placeAssetsOnCanvas(assets)) {
      showToast('error', '项目未就绪，请稍后重试');
    }
  };

  return { placeAssetsOnCanvas, handleAssetsPickerSelect };
}
