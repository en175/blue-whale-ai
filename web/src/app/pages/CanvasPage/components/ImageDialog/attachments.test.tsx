// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog, { type ImageTextAttachment, type UploadedFile } from './index';
import thumbStyles from '../RefThumbnail/index.module.css';


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
      features: {},
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/app/api/generation', () => ({ fetchGenerationModels }));

let root: Root;
let container: HTMLDivElement;

async function renderDialog(props: {
  attachments?: ImageTextAttachment[];
  initialFiles?: UploadedFile[];
  onSend?: ReturnType<typeof vi.fn>;
  onRemoveAttachment?: ReturnType<typeof vi.fn>;
} = {}) {
  const onSend = props.onSend ?? vi.fn();
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
          initialFiles: props.initialFiles,
          attachments: props.attachments,
          onRemoveAttachment: props.onRemoveAttachment,
        })
      ),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
  return { onSend };
}

const textThumbs = () => [...container.querySelectorAll('[data-testid="dock-text-ref"]')];
const mediaThumbs = () => [...container.querySelectorAll('[data-testid="ref-thumb"]:not([data-testid="dock-text-ref"])')];
const rowTestids = () =>
  [...(container.querySelector('[class*="previewRow"]')?.children ?? [])].map((el) =>
    el.getAttribute('data-testid') ?? '?',
  );

function hover(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  });
}

function unhover(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  });
}

function preview(): Element | null {
  return document.querySelector('[data-testid="ref-thumb-preview"]');
}

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKFCKN 文本附件进参考栏', () => {
  const two: ImageTextAttachment[] = [
    { nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' },
    { nodeId: 't2', title: '配色参考', text: '深蓝与银白' },
  ];

  it('文本附件以 FileText 图标缩略图进参考栏：与媒体同排（媒体在前）、编号圆钮仅数字', async () => {
    await renderDialog({
      initialFiles: [{ id: 'f1', url: 'https://x/a.png', type: 'image', name: '角色图' }],
      attachments: two,
    });

    expect(mediaThumbs()).toHaveLength(1);
    const thumbs = textThumbs();
    expect(thumbs).toHaveLength(2);
    for (const el of thumbs) {
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('video')).toBeNull();
      expect(el.querySelector(`.${thumbStyles.kindIcon}`)).toBeTruthy();
    }
    expect(thumbs[0].querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('1');
    expect(thumbs[1].querySelector('[data-testid="ref-thumb-badge"]')?.textContent).toBe('2');
    expect(rowTestids()).toEqual(['ref-thumb', 'dock-text-ref', 'dock-text-ref']);
  });

  it('独立「文本附件（N）」区块不再出现：无区块标题、无折叠正文、无上移/下移', async () => {
    await renderDialog({ attachments: two });

    expect(container.textContent).not.toContain('文本附件（');
    expect(container.textContent).not.toContain('故事文案');
    expect(
      [...container.querySelectorAll('button')].some((b) =>
        ['上移', '下移'].includes(b.getAttribute('title') ?? ''),
      ),
    ).toBe(false);
  });

  it('点击 × 立即删除：仅调 onRemoveAttachment 断开当前连线（携带来源 nodeId），无确认弹窗', async () => {
    const onRemoveAttachment = vi.fn();
    await renderDialog({ attachments: two, onRemoveAttachment });

    const removeBtns = textThumbs().map((el) =>
      el.querySelector<HTMLButtonElement>('button[title="移除"]')!,
    );
    expect(removeBtns).toHaveLength(2);
    await act(async () => {
      removeBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onRemoveAttachment).toHaveBeenCalledTimes(1);
    expect(onRemoveAttachment).toHaveBeenCalledWith('t2');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('悬停满 200ms 浮出正文内容预览；移出图标后延迟窗口内保持、超时关闭（IKFCX4）', async () => {
    await renderDialog({ attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }] });

    const el = textThumbs()[0]!;
    await act(async () => {
      hover(el);
      await wait(80);
    });
    expect(preview()).toBeNull();
    await act(async () => {
      await wait(250);
    });
    expect(preview()).toBeTruthy();
    expect(preview()!.textContent).toContain('一只蓝鲸在海里');
    expect(preview()!.textContent).not.toContain('故事文案');
    await act(async () => {
      unhover(el);
    });
    expect(preview(), '移出图标后短窗内不关闭（给移入浮层留时间）').toBeTruthy();
    await act(async () => {
      await wait(300);
    });
    expect(preview(), '未移入浮层则延迟后关闭').toBeNull();
  });

  it('同名文本卡不串用内容：多附件各自悬浮显示各自正文（IKFCX4）', async () => {
    await renderDialog({
      attachments: [
        { nodeId: 't1', title: '雨夜', text: '赛博朋克，霓虹灯' },
        { nodeId: 't2', title: '雨夜', text: '青石板路，油纸伞' },
      ],
    });
    const thumbs = textThumbs();
    expect(thumbs).toHaveLength(2);

    await act(async () => {
      hover(thumbs[0]!);
      await wait(250);
    });
    expect(preview()!.textContent).toContain('赛博朋克，霓虹灯');
    await act(async () => {
      unhover(thumbs[0]!);
      await wait(300);
    });
    expect(preview()).toBeNull();

    await act(async () => {
      hover(thumbs[1]!);
      await wait(250);
    });
    expect(preview()!.textContent).toContain('青石板路，油纸伞');
  });

  it('无文本附件时参考栏不出现文本缩略图', async () => {
    await renderDialog();
    expect(textThumbs()).toHaveLength(0);
  });
});

describe('IKDLQF 文本附件发送门槛', () => {
  it('附件正文有效时允许空提示词提交', async () => {
    const { onSend } = await renderDialog({
      attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }],
    });

    expect(sendButton().disabled).toBe(false);
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onSend).toHaveBeenCalledWith('', 'm-test', '2k', '1:1', [], null);
  });

  it('附件正文仅含空白时沿用提示词必填（发送禁用）', async () => {
    await renderDialog({
      attachments: [{ nodeId: 't1', title: '空白附件', text: '   ' }],
    });
    expect(sendButton().disabled).toBe(true);
  });

  it('无附件且提示词为空时保持提示词必填（发送禁用）', async () => {
    await renderDialog();
    expect(sendButton().disabled).toBe(true);
  });
});
