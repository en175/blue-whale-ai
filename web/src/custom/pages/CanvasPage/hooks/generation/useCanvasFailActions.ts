import { useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { RefObject } from 'react';
import { fetchHomeQuote, type HomeQuotePayload, type HomeQuoteRef } from '@/custom/api/homeQuote';
import type { GenerationModel } from '@/custom/api/generation';
import { useRechargeUiStore } from '@/custom/stores/recharge';
import { effectiveVideoParams, type VideoMode } from '@/custom/utils/video-modes';
import { mergedVideoRefsWithTextIndex } from '../../graph/textIndexSync';
import { draftVideoModeOf, defaultVideoModeFor } from '../../tools/video/videoModes';

export interface RequoteState {
  phase: 'loading' | 'ready' | 'unavailable';
  credits?: number;
}

export interface CanvasFailActionsHost {
  mediaNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<import('@xyflow/react').Edge[]>;
  textNodesRef: RefObject<Node[]>;
  draftModelOf: (nodeId: string | null | undefined, kind: 'video' | 'image') => GenerationModel | undefined;
  openMediaDraftDialog: (nodeId: string, mediaType: unknown) => void;
  updateGenerate: (nodeId: string) => void;
}

export interface CanvasFailActionsHandles {
  requoteByNode: ReadonlyMap<string, RequoteState>;
  handleEditFailed: (nodeId: string) => void;
  handleRechargeFailed: (nodeId: string) => void;
  handleRequoteFailed: (nodeId: string) => void;
  handleRequoteConfirm: (nodeId: string) => void;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function quoteReferencesOf(refs: ReturnType<typeof mergedVideoRefsWithTextIndex>): HomeQuoteRef[] {
  const list: HomeQuoteRef[] = [];
  if (refs.first) list.push({ type: 'image' });
  if (refs.last) list.push({ type: 'image' });
  for (const ref of refs.reference) {
    if (ref.mediaType === 'image') list.push({ type: 'image' });
    else if (ref.mediaType === 'video') list.push({ type: 'video', ...(ref.duration != null ? { duration: Math.round(ref.duration) } : {}) });
  }
  return list;
}

export function useCanvasFailActions(host: CanvasFailActionsHost): CanvasFailActionsHandles {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [requoteByNode, setRequoteByNode] = useState<Map<string, RequoteState>>(() => new Map());

  const setRequote = (nodeId: string, state: RequoteState | null) => {
    setRequoteByNode((prev) => {
      const next = new Map(prev);
      if (state === null) next.delete(nodeId);
      else next.set(nodeId, state);
      return next;
    });
  };

  const handleEditFailed = (nodeId: string) => {
    const { mediaNodesRef, openMediaDraftDialog } = hostRef.current;
    const node = mediaNodesRef.current.find((item) => item.id === nodeId);
    if (!node) return;
    openMediaDraftDialog(nodeId, (node.data ?? {}).mediaType);
  };

  const handleRechargeFailed = (nodeId: string) => {
    setRequote(nodeId, null);
    useRechargeUiStore.getState().openRecharge();
  };

  const buildQuotePayload = (nodeId: string): HomeQuotePayload | null => {
    const { mediaNodesRef, edgesRef, textNodesRef, draftModelOf } = hostRef.current;
    const node = mediaNodesRef.current.find((item) => item.id === nodeId);
    if (!node) return null;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const modelId = textOf(data.draftModelId);
    const mediaType = data.mediaType;
    if (!modelId || (mediaType !== 'image' && mediaType !== 'video')) return null;
    const model = draftModelOf(nodeId, mediaType);
    if (!model) return null;
    const prompt = textOf(data.prompt);
    if (mediaType === 'image') {
      const size = textOf(data.draftSize);
      const ratio = textOf(data.draftRatio);
      if (!size || !ratio) return null;
      return {
        type: 'image',
        parameters: { model_id: modelId, size, aspect_ratio: ratio, ...(prompt.trim() ? { prompt } : {}) },
        references: [],
      };
    }
    const refs = mergedVideoRefsWithTextIndex(nodeId, edgesRef.current, mediaNodesRef.current, textNodesRef.current);
    const mode = (draftVideoModeOf(data, refs) ?? defaultVideoModeFor(refs)) as VideoMode;
    const wire = effectiveVideoParams(model.features, mode, {
      aspectRatio: textOf(data.draftRatio),
      duration: typeof data.draftDuration === 'number' ? data.draftDuration : Number(data.draftDuration),
    });
    const sizeEntry = model.supported_sizes.find((size) => size.id === textOf(data.draftSize));
    const resolution = sizeEntry?.api_value ?? sizeEntry?.id ?? textOf(data.draftSize);
    if (!wire.aspect_ratio || !resolution || !Number.isFinite(wire.duration)) return null;
    return {
      type: 'video',
      parameters: {
        model_id: modelId,
        mode,
        aspect_ratio: wire.aspect_ratio,
        resolution,
        duration: wire.duration,
        ...(model.features.audio === true ? { generate_audio: data.draftGenerateAudio === true } : {}),
        ...(prompt.trim() ? { prompt } : {}),
      },
      references: quoteReferencesOf(refs),
    };
  };

  const handleRequoteFailed = (nodeId: string) => {
    const payload = buildQuotePayload(nodeId);
    if (!payload) {
      setRequote(nodeId, { phase: 'unavailable' });
      return;
    }
    setRequote(nodeId, { phase: 'loading' });
    fetchHomeQuote(payload)
      .then((credits) => {
        setRequote(nodeId, credits != null ? { phase: 'ready', credits } : { phase: 'unavailable' });
      })
      .catch(() => {
        setRequote(nodeId, { phase: 'unavailable' });
      });
  };

  const handleRequoteConfirm = (nodeId: string) => {
    const state = requoteByNode.get(nodeId);
    if (state?.phase !== 'ready') return;
    setRequote(nodeId, null);
    hostRef.current.updateGenerate(nodeId);
  };

  return { requoteByNode, handleEditFailed, handleRechargeFailed, handleRequoteFailed, handleRequoteConfirm };
}
