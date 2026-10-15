// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioDialog, { type AudioRefItem } from './index';
import type { ImageTextAttachment } from '../ImageDialog';
import AttachmentActionBar, {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from '../AttachmentActionBar';
import { REF_SOURCE_ENTRY_TITLE } from '../RefSourceMenu';
import barStyles from '../AttachmentActionBar/index.module.css';
import dialogStyles from './index.module.css';


const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'm-audio',
      provider_id: 'prov',
      model_label: '测试音频模型',
      icon: null,
      supported_sizes: [],
      supported_aspect_ratios: [],
      supported_formats: [],
      supported_durations: { min: 1, max: 120, step: 1 },
      default_size: null,
      default_format: null,
      default_aspect_ratio: null,
      default_duration: null,
      features: {},
      is_default: false,
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/app/api/generation', () => ({ fetchGenerationModels }));

let root: Root;
let container: HTMLDivElement;

const audioRef = (id: string, assetId: number): AudioRefItem => ({
  id,
  kind: 'audio',
  name: `音频${id}`,
  src: `https://x/${id}.mp3`,
  source: 'canvas',
  assetId,
});

async function renderDialog(props: Partial<Parameters<typeof AudioDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onPickFromCanvas = vi.fn();
  const onPickFromAssets = vi.fn();
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(AudioDialog, {
          onClose: vi.fn(),
          onSend: vi.fn(),
          canvasMedia: [],
          onPickFromCanvas,
          onPickFromAssets,
          ...props,
        })
      ),
    );
  });
  const readOnly = props.draftBinding?.submitting === true || props.draftBinding?.status === 'generating';
  await vi.waitFor(() =>
    expect(container.textContent).toContain(readOnly ? '生成中，参数只读' : '测试音频模型'));
  return { onPickFromCanvas, onPickFromAssets };
}

const actionBar = () => container.querySelector(`.${barStyles.actionBar}`);
const attachmentStrip = () => container.querySelector(`.${dialogStyles.topRow}`);
const pickCanvasBtn = () =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_CANVAS_TITLE || b.textContent === '参考',
  )!;
const pickAssetsBtn = () =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE || b.textContent === '资产库',
  )!;

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKGB82 附件操作条渲染与位置', () => {
  it('操作条为第一行：左「+ 参考」「资产库」pill，右侧并入展开/关闭按钮；旧「+」菜单退役', async () => {
    await renderDialog();

    const bar = actionBar()!;
    expect(bar).toBeTruthy();
    const actions = bar.querySelector(`.${barStyles.actions}`)!;
    expect(actions.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_CANVAS_TITLE}"]`)).toBeTruthy();
    expect(actions.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_ASSETS_TITLE}"]`)).toBeTruthy();
    const trailing = bar.querySelector(`.${barStyles.trailing}`)!;
    expect(trailing.querySelector('button[title="展开"]')).toBeTruthy();
    expect(trailing.querySelector('button[title="关闭"]')).toBeTruthy();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].some(
        (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
      ),
    ).toBe(false);
    const editor = container.querySelector('[contenteditable]')!;
    expect(bar.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('无附件时附件栏整条不渲染（操作条 + 输入框两段）', async () => {
    await renderDialog();
    expect(attachmentStrip()).toBeNull();
    expect(actionBar()).toBeTruthy();
  });

  it('有参考时附件栏出现在操作条与输入框之间；删光后重新隐藏', async () => {
    await renderDialog({ initialRefs: [audioRef('n1', 601)] });

    const bar = actionBar()!;
    const strip = attachmentStrip()!;
    expect(strip).toBeTruthy();
    const editor = container.querySelector('[contenteditable]')!;
    expect(bar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await click(container.querySelector('button[aria-label="移除 音频n1"]')!);
    expect(attachmentStrip()).toBeNull();
  });

  it('仅文本附件时附件栏同样出现（空态由实际附件项派生）', async () => {
    const attachments: ImageTextAttachment[] = [{ nodeId: 't1', title: '旁白文案', text: '夜幕降临。' }];
    await renderDialog({ attachments });
    expect(attachmentStrip()).toBeTruthy();
    expect(attachmentStrip()!.querySelector('[data-testid="dock-text-ref"]')).toBeTruthy();
  });
});

describe('IKGB82 两类点击分派（等价退役菜单两项）', () => {
  it('点「+ 参考」分派 onPickFromCanvas（startCanvasPick 既有行为保留），点「资产库」分派 onPickFromAssets', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog();

    await click(pickCanvasBtn());
    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
    expect(onPickFromAssets).not.toHaveBeenCalled();
    expect(container.textContent).toContain('从画布选择素材');

    await click(pickAssetsBtn());
    expect(onPickFromAssets).toHaveBeenCalledTimes(1);
    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
  });

  it('画布点选进行中「+ 参考」高亮（picking 态）', async () => {
    await renderDialog({ pickMode: true });
    expect(pickCanvasBtn().classList.contains(barStyles.picking)).toBe(true);
    expect(pickAssetsBtn().classList.contains(barStyles.picking)).toBe(false);
  });
});

describe('IKGB82 禁用态：常显置灰 + 悬停原因（替代入口消失）', () => {
  it('参考达上限：两按钮 aria-disabled、悬停说明已达上限，点击不分派；「已达上限」文案保留在附件栏原位', async () => {
    const initialRefs = [audioRef('n1', 601), audioRef('n2', 602), audioRef('n3', 603)];
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ initialRefs });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('参考音频最多 3 段，已达上限');
    }
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
    const limitText = attachmentStrip()!.querySelector(`.${dialogStyles.refCount}`)!;
    expect(limitText.textContent).toBe('已达上限');
    expect(limitText.getAttribute('title')).toBe('参考音频最多 3 段');
  });

  it('生成中只读：两按钮 aria-disabled、悬停说明生成中只读，点击不分派', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({
      draftBinding: { status: 'generating', onParamsChange: vi.fn() },
    });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('生成中，参数只读；可在画布卡片上取消生成');
    }
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
  });

  it('未达上限且非只读：按钮可用且悬停为入口语义', async () => {
    await renderDialog({ initialRefs: [audioRef('n1', 601)] });
    expect(pickCanvasBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickAssetsBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickCanvasBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_CANVAS_TITLE);
    expect(pickAssetsBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_ASSETS_TITLE);
  });
});

describe('IKGB82 kind 透传（音频面板类型边界）', () => {
  it('AttachmentActionBar kind="audio" 随点击透传宿主回调', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onPickFromCanvas = vi.fn();
    const onPickFromAssets = vi.fn();
    await act(async () => {
      root.render(
        createElement(AttachmentActionBar, {
          kind: 'audio',
          onPickFromCanvas,
          onPickFromAssets,
        }),
      );
    });

    await click(container.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_CANVAS_TITLE}"]`)!);
    expect(onPickFromCanvas).toHaveBeenCalledWith('audio', undefined);
    await click(container.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_ASSETS_TITLE}"]`)!);
    expect(onPickFromAssets).toHaveBeenCalledWith('audio', undefined);
  });
});
