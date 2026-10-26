import { type VideoRefRole } from '@/custom/enums';
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { promptBindingList } from '@lib/contracts/prompt-target';
import { promptMentionSchema } from '@lib/contracts/prompt-preview';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { planReferenceErrorFor, pickMarkedIdsFor, complianceBlockedIds, pendingPlanSyncsOf, canvasMediaOf, atMentionItemsOf } from '../../graph/canvasPureNodeHelpers';
import type { CanvasPickItem } from '../../components/AudioDialog';
import type { AtMentionItem } from '../../agent/atMention';
import { mergedImageRefsOf, mergedVideoRefsWithTextIndex } from '../../graph/textIndexSync';
import { videoRefIdentityIds } from '../../tools/video/videoMediaRefs';

export function useCanvasPlanMentions(input: {
  imageSeed: { targetNodeId?: string } | null | undefined;
  videoSeed: { targetNodeId?: string } | null | undefined;
  edges: Edge[];
  mediaNodes: Node[];
  textNodes: Node[];
  imagePickSession: string | boolean | null | undefined;
  imagePickSessionActive: boolean;
  videoPickSession: string | boolean | null | undefined;
  videoPickSessionActive: boolean;
  audioPickSession: string | boolean | null | undefined;
  audioPickSessionActive: boolean;
  pickRefRole: VideoRefRole | null;
  findCanvasNode: (id: string) => Node | undefined;
  setFocusViewport: Dispatch<SetStateAction<Viewport | undefined>>;
  setSelectRequest: Dispatch<SetStateAction<{ id: string; ts: number } | null>>;
  connectPlanToDraft: (planNodeId: string, targetId: string) => void;
}) {
  const {
    imageSeed,
    videoSeed,
    edges,
    mediaNodes,
    textNodes,
    imagePickSession,
    imagePickSessionActive,
    videoPickSession,
    videoPickSessionActive,
    audioPickSession,
    audioPickSessionActive,
    pickRefRole,
    findCanvasNode,
    setFocusViewport,
    setSelectRequest,
    connectPlanToDraft,
  } = input;
  const planReferenceErrors = useMemo(() => {
    const videoRefs = videoSeed?.targetNodeId
      ? mergedVideoRefsWithTextIndex(videoSeed.targetNodeId, edges, mediaNodes, textNodes)
      : { reference: [] };
    const videoAvailableIds = [...videoRefs.reference, ...(videoRefs.first ? [videoRefs.first] : []), ...(videoRefs.last ? [videoRefs.last] : [])]
      .flatMap((ref) => videoRefIdentityIds(ref));
    return {
      image: planReferenceErrorFor(
        imageSeed?.targetNodeId,
        imageSeed?.targetNodeId
          ? mergedImageRefsOf(imageSeed.targetNodeId, edges, [...mediaNodes, ...textNodes]).map((ref) => ref.assetId)
          : [],
        edges,
        textNodes,
      ),
      videoIndices: edges.filter(e => e.target === videoSeed?.targetNodeId).flatMap(e => {
        const plan = textNodes.find(n => n.id === e.source && n.data.promptSource);
        const mentions = promptMentionSchema.array().safeParse(plan?.data.promptMentions ?? []);
        return mentions.success ? promptBindingList(mentions.data).map(m => `#${m.index}`) : [];
      }).join('、'),
      video: planReferenceErrorFor(videoSeed?.targetNodeId, videoAvailableIds, edges, textNodes),
    };
  }, [imageSeed?.targetNodeId, videoSeed?.targetNodeId, edges, mediaNodes, textNodes]);
  const pendingPlanSyncs = (targetId: string | undefined) => pendingPlanSyncsOf(targetId, edges, textNodes);
  const syncPlanToTarget = (planNodeId: string, targetId: string | undefined) => {
    const pending = pendingPlanSyncs(targetId).find((plan) => plan.nodeId === planNodeId);
    if (pending && targetId) connectPlanToDraft(planNodeId, targetId);
  };
  const imagePickMarkedIds = useMemo(
    () => pickMarkedIdsFor(imagePickSession, imagePickSessionActive, edges, textNodes),
    [imagePickSessionActive, imagePickSession, edges, textNodes],
  );
  const videoPickMarkedIds = useMemo(
    () => pickMarkedIdsFor(videoPickSession, videoPickSessionActive, edges, textNodes, pickRefRole ?? 'reference'),
    [videoPickSessionActive, videoPickSession, pickRefRole, edges, textNodes],
  );
  const videoPickBlockedIds = useMemo(() => complianceBlockedIds(mediaNodes), [mediaNodes]);
  const audioPickMarkedIds = useMemo(
    () => pickMarkedIdsFor(audioPickSession, audioPickSessionActive, edges, textNodes),
    [audioPickSessionActive, audioPickSession, edges, textNodes],
  );
  const canvasMedia: CanvasPickItem[] = useMemo(() => canvasMediaOf(mediaNodes), [mediaNodes]);
  const atMentionItems: AtMentionItem[] = useMemo(() => atMentionItemsOf(mediaNodes, textNodes), [mediaNodes, textNodes]);
  const locateTextSource = useCallback((nodeId: string) => {
    const target = findCanvasNode(nodeId);
    if (!target) return;
    const width = (target as Node & { measured?: { width?: number } }).measured?.width ?? 360;
    const height = (target as Node & { measured?: { height?: number } }).measured?.height ?? 270;
    setFocusViewport({ x: window.innerWidth / 2 - (target.position.x + width / 2), y: window.innerHeight / 2 - (target.position.y + height / 2), zoom: 1 });
    setSelectRequest({ id: nodeId, ts: Date.now() });
  }, [findCanvasNode, setFocusViewport, setSelectRequest]);
  return {
    planReferenceErrors,
    pendingPlanSyncs,
    syncPlanToTarget,
    imagePickMarkedIds,
    videoPickMarkedIds,
    videoPickBlockedIds,
    audioPickMarkedIds,
    canvasMedia,
    atMentionItems,
    locateTextSource,
  };
}
