// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioMixBar from './index';
import type { AudioMixInputSelection } from '../../audioMix';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  uploadAssetFile: vi.fn(),
}));
vi.mock('@/api/http', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('@/utils/upload', () => ({ uploadAssetFile: mocks.uploadAssetFile }));

const source: Node = {
  id: 'source', type: 'mediaNode', position: { x: 0, y: 0 },
  data: { assetId: '8', fileName: '固定源.mp3', src: '/fixed.mp3', mediaType: 'audio', duration: 10 },
};
const canvas: Node[] = [
  { id: 'second', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '6', fileName: '画布音频.mp3', src: '/canvas.mp3', mediaType: 'audio', duration: 25 } },
  { id: 'duplicate', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '8', fileName: '同资产另一卡.mp3', src: '/dup.mp3', mediaType: 'audio', duration: 12 } },
  { id: 'pending', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '20', fileName: '生成中.mp3', src: '', mediaType: 'audio', genStatus: 'generating' } },
];
const libraryPage = {
  records: [
    { id: 8, type: 'audio', url: '/fixed.mp3', duration: 10, source: 'uploaded', model: null, width: null, height: null, created_at: null },
    { id: 7, type: 'audio', url: '/library.mp3', duration: null, source: 'uploaded', model: null, width: null, height: null, created_at: null },
    { id: 10, type: 'audio', url: '', duration: null, source: 'uploaded', model: null, width: null, height: null, created_at: null },
  ], total: 3, size: 30, current: 1,
};

let root: Root;
let container: HTMLDivElement;
let sent = 0;
let selectedSnapshot: AudioMixInputSelection[] = [];

function Harness({ initial = [] }: { initial?: AudioMixInputSelection[] }) {
  const [selected, setSelected] = useState(initial);
  const [closed, setClosed] = useState(false);
  const [format, setFormat] = useState<'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac'>('mp3');
  selectedSnapshot = selected;
  const add = (item: AudioMixInputSelection) => setSelected((current) =>
    current.length < 99 && ![ '8', ...current.map((input) => input.assetId) ].includes(item.assetId)
      ? [...current, item] : current);
  if (closed) return null;
  return createElement(AudioMixBar, {
    source, candidates: canvas, selected, onAdd: add,
    onRemove: (assetId: string) => setSelected((items) => items.filter((item) => item.assetId !== assetId)),
    projectId: 'p1', format, onFormatChange: setFormat,
    onSend: () => { sent += 1; }, onClose: () => setClosed(true), submitting: false, anchor: null,
  });
}

async function render(initial: AudioMixInputSelection[] = []) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(Harness, { initial }))));
}

async function click(id: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sent = 0;
  selectedSnapshot = [];
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockResolvedValue(libraryPage);
  mocks.uploadAssetFile.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('IKI68X 音频混合选材浮层', () => {
  it('固定源不可删，画布与素材库跨入口按资产去重，未知时长显示待确定', async () => {
    await render();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-send"]')?.disabled).toBe(true);
    await click('audio-mix-add');
    expect(container.textContent).toContain('固定');
    expect(container.querySelector('[data-testid="audio-mix-remove-8"]')).toBeNull();
    await click('audio-mix-tab-canvas');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-candidate-duplicate"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-candidate-pending"]')?.disabled).toBe(true);
    await click('audio-mix-candidate-second');
    expect(selectedSnapshot).toEqual([{ assetId: '6', nodeId: 'second', name: '画布音频.mp3', duration: 25 }]);
    expect(container.textContent).toContain('预计 25s');
    await click('audio-mix-tab-library');
    await act(async () => { await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-mix-library-8"]')).not.toBeNull()); });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/assets?page=1&size=30&type=audio', { silent: true });
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-library-8"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-library-10"]')?.disabled).toBe(true);
    await click('audio-mix-library-7');
    expect(selectedSnapshot.map((item) => item.assetId)).toEqual(['6', '7']);
    expect(container.textContent).toContain('预计 待确定');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-library-7"]')?.disabled).toBe(true);
    await click('audio-mix-remove-6');
    expect(selectedSnapshot.map((item) => item.assetId)).toEqual(['7']);
  });

  it('上传完成且取得音频 Asset 后才加入，不建立画布节点身份', async () => {
    let complete!: (value: unknown) => void;
    mocks.uploadAssetFile.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    await render();
    await click('audio-mix-add');
    await click('audio-mix-tab-upload');
    const input = container.querySelector<HTMLInputElement>('[data-testid="audio-mix-upload-input"]')!;
    const file = new File(['audio'], 'upload.mp3', { type: 'audio/mpeg' });
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(selectedSnapshot).toEqual([]);
    expect(mocks.uploadAssetFile).toHaveBeenCalledWith(file, { projectId: 'p1' });
    await act(async () => complete({ asset_id: '9', status: 'ready', type: 'audio', url: '/uploaded.mp3', duration: 33 }));
    expect(selectedSnapshot).toEqual([{ assetId: '9', name: 'upload.mp3', duration: 33 }]);
  });

  it('上传期间退出混合后，迟到的 Asset 不进入下次选择', async () => {
    let complete!: (value: unknown) => void;
    mocks.uploadAssetFile.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    await render();
    await click('audio-mix-add');
    await click('audio-mix-tab-upload');
    const input = container.querySelector<HTMLInputElement>('[data-testid="audio-mix-upload-input"]')!;
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['audio'], 'late.mp3', { type: 'audio/mpeg' })] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('audio-mix-close');
    await act(async () => complete({ asset_id: '9', status: 'ready', type: 'audio', url: '/late.mp3', duration: 4 }));
    expect(selectedSnapshot).toEqual([]);
  });

  it('固定源加 99 项可发送，第 101 段禁用；格式仍可选五项', async () => {
    const initial = Array.from({ length: 99 }, (_, index) => ({ assetId: String(index + 100), name: `已选${index + 1}`, duration: 1 }));
    await render(initial);
    await click('audio-mix-add');
    expect(container.textContent).toContain('音频 100/100');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-candidate-second"]')?.disabled).toBe(true);
    await click('audio-mix-tab-library');
    await act(async () => { await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-mix-library-7"]')).not.toBeNull()); });
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-mix-library-7"]')?.disabled).toBe(true);
    await click('audio-mix-send');
    expect(sent).toBe(1);
    await click('audio-mix-format-trigger');
    expect(container.querySelectorAll('[role="menuitemradio"]')).toHaveLength(5);
    await click('audio-mix-format-wav');
    expect(container.querySelector('[data-testid="audio-mix-format-trigger"]')?.textContent).toContain('wav');
  });
});
