// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BottomDialog from './index';
import type { ImageTextAttachment } from '../ImageDialog';
import type { VideoMediaRef, VideoMediaRefs } from '../../videoMediaRefs';
import type { PromptDoc } from '@/app/utils/prompt-doc';
import { readPromptRefText, typePromptRefRaw } from '../../testing/promptRefEditor';

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'seedance-2',
      provider_id: 'prov',
      model_label: '测试生视频模型',
      icon: null,
      supported_sizes: [{ id: '1080p', label: '1080P', api_value: '1080p' }],
      supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
      supported_formats: [],
      supported_durations: { min: 5, max: 5, step: 5 },
      default_size: '1080p',
      default_format: null,
      default_aspect_ratio: '16:9',
      default_duration: 5,
      features: { reference_image: true, image_reference_max: 9, first_frame: true, last_frame: true, first_last_frame: true, task_types: { text2video: {}, omni: {}, image_reference: {}, first_frame: {}, first_last_frame: {} } },
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/app/api/generation', () => ({ fetchGenerationModels }));

const IMG_A: VideoMediaRef = { nodeId: 'node-101', url: 'https://x/101', name: '素材101', assetId: '101', mediaType: 'image' };
const ATT_STYLE: ImageTextAttachment = { nodeId: 'text-1-style', title: '风格要求', text: '胶片感' };
const ATT_POSE: ImageTextAttachment = { nodeId: 'text-2-pose', title: '运镜说明', text: '手持跟拍' };

let root: Root;
let container: HTMLDivElement;

interface RenderOpts {
  videoMediaRefs?: VideoMediaRefs;
  attachments?: ImageTextAttachment[];
  initialDoc?: PromptDoc | null;
  initialParams?: { mode?: string };
  onSend?: ReturnType<typeof vi.fn>;
}

async function renderDialog(opts: RenderOpts = {}) {
  const onSend = opts.onSend ?? vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BottomDialog, {
          onClose: vi.fn(),
          onSend,
          initialDoc: opts.initialDoc ?? null,
          initialParams: opts.initialParams ?? { mode: 'all' },
          attachments: opts.attachments,
          videoDraftBinding: { onParamsChange: vi.fn() },
          videoMediaRefs: opts.videoMediaRefs ?? { reference: [] },
        } as Parameters<typeof BottomDialog>[0])
      ),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生视频模型'));
  return { onSend };
}

async function rerender(opts: RenderOpts = {}) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BottomDialog, {
          onClose: vi.fn(),
          onSend: vi.fn(),
          attachments: opts.attachments,
          videoDraftBinding: { onParamsChange: vi.fn() },
          videoMediaRefs: opts.videoMediaRefs ?? { reference: [] },
        } as Parameters<typeof BottomDialog>[0])
      ),
    );
  });
}

function sendButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('[data-testid="video-send"]')!;
}

function mentionMenuItems(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-testid="mention-ref-item"]')];
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('IKFA1P 生视频文本附件索引（A2 文本部分）', () => {
  it('@ 菜单媒体与文本混排：文本项按附件顺序编号，选择后插入 文本N（E4）', async () => {
    await renderDialog({ videoMediaRefs: { reference: [IMG_A] }, attachments: [ATT_STYLE, ATT_POSE] });
    await typePromptRefRaw(container, '让@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = mentionMenuItems();
    expect(items.map((b) => b.textContent)).toEqual(['素材101图片1', '风格要求文本1', '运镜说明文本2']);
    await act(async () => {
      items[2]!.click();
    });
    expect(readPromptRefText(container)).toBe('让文本2');
  });

  it('移除文本附件 → 相关标签失效并阻止发送；同身份重新连入自动恢复（B1/B4）', async () => {
    await renderDialog({
      attachments: [ATT_STYLE, ATT_POSE],
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '按' },
          { kind: 'text_ref', node_id: 'text-2-pose', label: '文本2' },
          { kind: 'text', text: '运镜' },
        ],
      },
    });
    expect(readPromptRefText(container)).toBe('按文本2运镜');
    await rerender({ attachments: [ATT_STYLE] });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('按已失效：原文本2运镜'));
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('正文有已失效的素材标签');
    await rerender({ attachments: [ATT_STYLE, ATT_POSE] });
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('按文本2运镜'));
    expect(sendButton().disabled).toBe(false);
  });

  it('IKIQGR：@ 查询命中长正文尾段（超过前 200 字）的文本附件，选择后插入 文本N 标签', async () => {
    const ATT_LONG: ImageTextAttachment = {
      nodeId: 'text-long',
      title: '观浪笔记',
      text: `${'浪'.repeat(260)}OceanWhale 深海观测日志`,
    };
    await renderDialog({ attachments: [ATT_STYLE, ATT_LONG] });
    await typePromptRefRaw(container, '结合@深海观测');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = mentionMenuItems();
    expect(items.map((b) => b.textContent)).toEqual(['观浪笔记文本2']);
    expect(items[0]!.textContent).not.toContain('深海观测');
    await act(async () => {
      items[0]!.click();
    });
    expect(readPromptRefText(container)).toBe('结合文本2');
  });

  it('媒体与文本混排正文发送携带 prompt_doc：text_ref 与 asset_ref 片段原样上送（D5 文本）', async () => {
    const { onSend } = await renderDialog({
      videoMediaRefs: { reference: [IMG_A] },
      attachments: [ATT_STYLE],
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '让' },
          { kind: 'asset_ref', asset_id: '101', label: '图片1' },
          { kind: 'text', text: '按' },
          { kind: 'text_ref', node_id: 'text-1-style', label: '文本1' },
          { kind: 'text', text: '调整' },
        ],
      },
    });
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());
    expect(onSend).toHaveBeenCalledTimes(1);
    const doc = onSend.mock.calls[0][2] as PromptDoc;
    expect(doc.segments.filter((s) => s.kind === 'text_ref')).toEqual([
      { kind: 'text_ref', node_id: 'text-1-style', label: '文本1' },
    ]);
    expect(onSend.mock.calls[0][0]).toBe('让图片1按文本1调整');
  });
});
