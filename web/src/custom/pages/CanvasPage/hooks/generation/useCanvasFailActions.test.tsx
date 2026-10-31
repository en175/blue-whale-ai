// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { GenerationModel } from '@/custom/api/generation';

const hoisted = vi.hoisted(() => ({
  openRecharge: vi.fn(),
  fetchHomeQuote: vi.fn(),
}));

vi.mock('@/custom/stores/recharge', () => ({
  useRechargeUiStore: {
    getState: () => ({ openRecharge: hoisted.openRecharge }),
  },
}));

vi.mock('@/custom/api/homeQuote', () => ({
  fetchHomeQuote: hoisted.fetchHomeQuote,
}));

const { useCanvasFailActions } = await import('./useCanvasFailActions');

function model(): GenerationModel {
  return {
    model_id: 'm1',
    provider_id: 'p',
    model_label: 'M1',
    icon: null,
    supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
    supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
    supported_formats: ['mp4'],
    supported_durations: { min: 4, max: 15, step: 1 },
    default_size: '720p',
    default_format: 'mp4',
    default_aspect_ratio: '16:9',
    default_duration: 5,
    features: {
      reference_image: true,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      audio: false,
      image_reference_max: 10,
    },
    is_default: true,
    version: 1,
    digest: '',
  };
}

function imageNode(): Node {
  return {
    id: 'n1',
    data: { mediaType: 'image', draftModelId: 'm1', draftSize: '720p', draftRatio: '16:9', prompt: '海边日落' },
  } as unknown as Node;
}

async function mountActions(host: {
  mediaNodesRef: { current: Node[] };
  openMediaDraftDialog: (nodeId: string, mediaType: unknown) => void;
  updateGenerate: (nodeId: string) => void;
}) {
  let actions: ReturnType<typeof useCanvasFailActions> | null = null;
  const Probe = () => {
    actions = useCanvasFailActions({
      edgesRef: { current: [] as Edge[] },
      textNodesRef: { current: [] as Node[] },
      draftModelOf: () => model(),
      ...host,
    });
    return null;
  };
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(createElement(Probe)); });
  return {
    actions: () => actions!,
    unmount: () => act(async () => { root.unmount(); }),
  };
}

beforeEach(() => {
  hoisted.openRecharge.mockClear();
  hoisted.fetchHomeQuote.mockReset();
  hoisted.fetchHomeQuote.mockResolvedValue(42);
});

describe('useCanvasFailActions', () => {
  it('修改失败原因时打开原画布的生成面板，不新建任务', async () => {
    const openMediaDraftDialog = vi.fn();
    const updateGenerate = vi.fn();
    const handle = await mountActions({
      mediaNodesRef: { current: [imageNode()] },
      openMediaDraftDialog,
      updateGenerate,
    });

    await act(async () => { handle.actions().handleEditFailed('n1'); });

    expect(openMediaDraftDialog).toHaveBeenCalledWith('n1', 'image');
    expect(updateGenerate).not.toHaveBeenCalled();
    await handle.unmount();
  });

  it('充值动作打开积分超市，不自动提交', async () => {
    const handle = await mountActions({
      mediaNodesRef: { current: [imageNode()] },
      openMediaDraftDialog: vi.fn(),
      updateGenerate: vi.fn(),
    });

    await act(async () => { handle.actions().handleRechargeFailed('n1'); });

    expect(hoisted.openRecharge).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchHomeQuote).not.toHaveBeenCalled();
    await handle.unmount();
  });

  it('变价先按节点参数取新报价，确认后才在原节点重新生成', async () => {
    const updateGenerate = vi.fn();
    const handle = await mountActions({
      mediaNodesRef: { current: [imageNode()] },
      openMediaDraftDialog: vi.fn(),
      updateGenerate,
    });

    await act(async () => { handle.actions().handleRequoteFailed('n1'); });
    await act(async () => { await Promise.resolve(); });

    expect(hoisted.fetchHomeQuote).toHaveBeenCalledWith({
      type: 'image',
      parameters: { model_id: 'm1', size: '720p', aspect_ratio: '16:9', prompt: '海边日落' },
      references: [],
    });
    expect(handle.actions().requoteByNode.get('n1')).toEqual({ phase: 'ready', credits: 42 });
    expect(updateGenerate).not.toHaveBeenCalled();

    await act(async () => { handle.actions().handleRequoteConfirm('n1'); });
    expect(updateGenerate).toHaveBeenCalledWith('n1');
    await handle.unmount();
  });

  it('取不到报价时按钮保持不可确认', async () => {
    hoisted.fetchHomeQuote.mockResolvedValue(null);
    const updateGenerate = vi.fn();
    const handle = await mountActions({
      mediaNodesRef: { current: [imageNode()] },
      openMediaDraftDialog: vi.fn(),
      updateGenerate,
    });

    await act(async () => { handle.actions().handleRequoteFailed('n1'); });
    await act(async () => { await Promise.resolve(); });
    expect(handle.actions().requoteByNode.get('n1')).toEqual({ phase: 'unavailable' });

    await act(async () => { handle.actions().handleRequoteConfirm('n1'); });
    expect(updateGenerate).not.toHaveBeenCalled();
    await handle.unmount();
  });
});
