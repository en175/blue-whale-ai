// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { GenerationModel } from '@/custom/api/generation';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaNodes,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ records: [], next_cursor: null, protocol_version: 1, canvas_version: null }),
  })),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
}));


beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  seedSourcesDoc();
  apiMocks.fetchGenerationModels.mockImplementation(async (...capability: string[]) => {
    if (capability[0] === 'video') return [model('测试视频模型')];
    if (capability[0] === 'audio') return [model('测试音频模型')];
    return [model('测试生图模型')];
  });
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

function model(label: string): GenerationModel {
  return {
    model_id: `m-${label}`,
    provider_id: 'prov',
    model_label: label,
    icon: null,
    supported_sizes: [],
    supported_aspect_ratios: [],
    supported_formats: [],
    supported_durations: null,
    default_size: null,
    default_format: null,
    default_aspect_ratio: null,
    default_duration: null,
    features: {
      reference_image: false,
      image_reference_max: 0,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: false,
      last_frame: false,
      first_last_frame: false,
      audio: false,
    },
    is_default: true,
    version: 1,
    digest: '',
  };
}

function seedSourcesDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'img1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { src: 'http://img/a.png', mediaType: 'image', fileName: '上传图.png', assetId: 'a1', mime: 'image/png' } },
        { id: 'vid1', type: 'mediaNode', position: { x: 300, y: 0 }, data: { src: 'http://vid/a.mp4', mediaType: 'video', fileName: '上传视频.mp4', assetId: 'a2', mime: 'video/mp4' } },
        { id: 'aud1', type: 'mediaNode', position: { x: 600, y: 0 }, data: { src: 'http://aud/a.mp3', mediaType: 'audio', fileName: '上传音频.mp3', assetId: 'a3', mime: 'audio/mpeg' } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/a.png', width: 1600, height: 900 },
      a2: { asset_id: 2, type: 'video', access_url: 'http://vid/a.mp4', width: 1920, height: 1080 },
      a3: { asset_id: 3, type: 'audio', access_url: 'http://aud/a.mp3' },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

function mediaNode(id: string): Node {
  return (mediaNodes() as Node[]).find((n) => n.id === id)!;
}

async function dropFromNodeOnBlank(id: string) {
  document.elementsFromPoint = () => [];
  await act(async () => {
    flowProps.current.onConnectEnd(
      new MouseEvent('mouseup', { clientX: 500, clientY: 400 }),
      { fromNode: mediaNode(id) },
    );
  });
}

function menuItem(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent === label) ?? null;
}

async function pickMenuKind(label: string) {
  await vi.waitFor(() => expect(menuItem(label)).toBeTruthy());
  await act(async () => {
    menuItem(label)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function expectDraftCardAndEdge(sourceId: string, mediaType: 'image' | 'video' | 'audio', fileName: string) {
  const draft = (mediaNodes() as Node[]).find((n) => n.id.startsWith('media-draft'));
  expect(draft).toBeTruthy();
  expect(draft!.data).toMatchObject({ draft: true, mediaType, fileName });
  const edges = flowProps.current.edges as Edge[];
  expect(edges.some((e) => e.source === sourceId && e.target === draft!.id)).toBe(true);
  return draft!;
}

describe('IKH3WE 拖线落空白经类型菜单派生新卡', () => {
  it('图片来源卡拖线落空白：三项类型齐全，选「图片生成」建图片草稿卡+参考边+打开图片面板', async () => {
    await renderPage();
    await dropFromNodeOnBlank('img1');

    await vi.waitFor(() => expect(menuItem('图片生成')).toBeTruthy());
    expect(menuItem('视频生成')).toBeTruthy();
    expect(menuItem('音频生成')).toBeTruthy();

    await pickMenuKind('图片生成');
    const draft = expectDraftCardAndEdge('img1', 'image', '图片草稿');
    expect(menuItem('图片生成')).toBeNull();
    await vi.waitFor(() => expect(document.body.textContent).toContain('测试生图模型'));
    expect(draft.selected).toBe(true);
  });

  it('视频来源卡拖线落空白：选「视频生成」建视频草稿卡+普通参考边+打开视频面板', async () => {
    await renderPage();
    await dropFromNodeOnBlank('vid1');

    await pickMenuKind('视频生成');
    expectDraftCardAndEdge('vid1', 'video', '视频草稿');
    await vi.waitFor(() => expect(document.body.textContent).toContain('测试视频模型'));
  });

  it('音频来源卡拖线落空白：图片生成置灰（能力集无 image），选「音频生成」建音频草稿卡+参考边+打开音频面板', async () => {
    await renderPage();
    await dropFromNodeOnBlank('aud1');

    await vi.waitFor(() => expect(menuItem('音频生成')).toBeTruthy());
    expect(menuItem('图片生成')!.disabled).toBe(true);

    await pickMenuKind('音频生成');
    expectDraftCardAndEdge('aud1', 'audio', '音频草稿');
    await vi.waitFor(() => expect(document.body.textContent).toContain('测试音频模型'));
  });
});
