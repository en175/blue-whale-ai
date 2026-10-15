// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog, { type ImageTextAttachment } from './index';
import { composeImageSendPrompt } from './composeImageSendPrompt';
import type { PromptDoc } from '@/app/utils/prompt-doc';
import { readPromptRefText, typePromptRefRaw } from '../../testing/promptRefEditor';

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'm-test',
      provider_id: 'prov',
      model_label: '测试生图模型',
      icon: null,
      supported_sizes: [{ id: '2k', label: '2K' }],
      supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
      supported_formats: [],
      supported_durations: null,
      default_size: '2k',
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: { reference_image: true, image_reference_max: 9 },
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/app/api/generation', () => ({ fetchGenerationModels }));

const ATT_STYLE: ImageTextAttachment = { nodeId: 'text-1-style', title: '风格要求', text: '赛博朋克，霓虹灯' };
const ATT_POSE: ImageTextAttachment = { nodeId: 'text-2-pose', title: '姿势说明', text: '站立微笑' };

let root: Root;
let container: HTMLDivElement;

async function renderDialog(props: {
  attachments?: ImageTextAttachment[];
  initialDoc?: PromptDoc | null;
  onSend?: ReturnType<typeof vi.fn>;
  onParamsChange?: ReturnType<typeof vi.fn>;
} = {}) {
  const onSend = props.onSend ?? vi.fn();
  const onParamsChange = props.onParamsChange ?? vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(ImageDialog, {
          onClose: vi.fn(),
          onSend,
          initialDoc: props.initialDoc ?? null,
          attachments: props.attachments,
          draftBinding: { onParamsChange },
        } as Parameters<typeof ImageDialog>[0])
      ),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
  return { onSend, onParamsChange };
}

async function rerender(attachments: ImageTextAttachment[]) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(ImageDialog, {
          onClose: vi.fn(),
          onSend: vi.fn(),
          attachments,
          draftBinding: { onParamsChange: vi.fn() },
        } as Parameters<typeof ImageDialog>[0])
      ),
    );
  });
}

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
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

describe('IKFA1P 生图文本附件索引（A2 文本部分）', () => {
  it('@ 菜单列出文本附件（编号跟附件顺序），选择后光标处插入 文本N 标签', async () => {
    await renderDialog({ attachments: [ATT_STYLE, ATT_POSE] });
    await typePromptRefRaw(container, '按@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = mentionMenuItems();
    expect(items.map((b) => b.textContent)).toEqual(['风格要求文本1', '姿势说明文本2']);
    await act(async () => {
      items[0]!.click();
    });
    expect(readPromptRefText(container)).toBe('按文本1');
  });

  it('文本项可按标题搜索；参考栏文本缩略图展示同源编号（角标仅数字）', async () => {
    await renderDialog({ attachments: [ATT_STYLE, ATT_POSE] });
    const badges = [...container.querySelectorAll('[data-testid="dock-text-ref"] [data-testid="ref-thumb-badge"]')].map((e) => e.textContent);
    expect(badges).toEqual(['1', '2']);
    await typePromptRefRaw(container, '@姿势');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    const items = mentionMenuItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('文本2');
  });

  it('同一文本多次提及：重复选择不新建附件，标签均指向同一来源（A4/E4）', async () => {
    await renderDialog({ attachments: [ATT_STYLE] });
    await typePromptRefRaw(container, '先@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    await act(async () => mentionMenuItems()[0]!.click());
    await typePromptRefRaw(container, '再@');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="mention-menu"]')).toBeTruthy());
    await act(async () => mentionMenuItems()[0]!.click());
    expect(readPromptRefText(container)).toBe('先文本1再文本1');
    expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1);
  });
});

describe('IKFA1P 生图文本失效与恢复（B 类文本场景）', () => {
  it('移除附件（断开连线）→ 标签失效保留原指向并阻止发送；同身份重新加入自动恢复（B1/B4）', async () => {
    await renderDialog({
      attachments: [ATT_STYLE, ATT_POSE],
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '按' },
          { kind: 'text_ref', node_id: 'text-2-pose', label: '文本2' },
          { kind: 'text', text: '调整' },
        ],
      },
    });
    expect(readPromptRefText(container)).toBe('按文本2调整');
    await rerender([ATT_STYLE]);
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('按已失效：原文本2调整'));
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('正文有已失效的素材标签');
    await rerender([ATT_POSE]);
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('按文本1调整'));
    expect(sendButton().disabled).toBe(false);
  });

  it('附件重排（IKDLQH）→ 编号跟随新顺序重派生，身份不变', async () => {
    await renderDialog({
      attachments: [ATT_STYLE, ATT_POSE],
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text_ref', node_id: 'text-1-style', label: '文本1' },
          { kind: 'text', text: '与' },
          { kind: 'text_ref', node_id: 'text-2-pose', label: '文本2' },
        ],
      },
    });
    expect(readPromptRefText(container)).toBe('文本1与文本2');
    await rerender([ATT_POSE, ATT_STYLE]);
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('文本2与文本1'));
  });
});

describe('IKFA1P 生图发送携带（D2/D5）', () => {
  it('正文含文本标签时发送携带 prompt_doc（text_ref 片段原样）', async () => {
    const { onSend } = await renderDialog({
      attachments: [ATT_STYLE],
      initialDoc: {
        version: 1,
        segments: [
          { kind: 'text', text: '按' },
          { kind: 'text_ref', node_id: 'text-1-style', label: '文本1' },
          { kind: 'text', text: '生成' },
        ],
      },
    });
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());
    expect(onSend).toHaveBeenCalledTimes(1);
    const doc = onSend.mock.calls[0][5] as PromptDoc;
    expect(doc.segments).toEqual([
      { kind: 'text', text: '按' },
      { kind: 'text_ref', node_id: 'text-1-style', label: '文本1' },
      { kind: 'text', text: '生成' },
    ]);
    expect(onSend.mock.calls[0][0]).toBe('按文本1生成');
  });
});

it('文本索引参与组合长度计算，空白附件保留编号位置', () => {
  const doc: PromptDoc = { version: 1, segments: [{ kind: 'text_ref', node_id: ATT_POSE.nodeId, label: '文本2' }] };
  expect(composeImageSendPrompt([{ ...ATT_STYLE, text: '' }, ATT_POSE], '按文本2', doc))
    .toBe('文本1：文本2：站立微笑按文本2');
});
