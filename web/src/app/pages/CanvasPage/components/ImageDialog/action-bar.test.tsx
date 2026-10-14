// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog, { type UploadedFile } from './index';
import AttachmentActionBar, {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from '../AttachmentActionBar';
import barStyles from '../AttachmentActionBar/index.module.css';
import dialogStyles from './index.module.css';


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

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

let root: Root;
let container: HTMLDivElement;

async function renderDialog(props: Partial<Parameters<typeof ImageDialog>[0]> = {}) {
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
        createElement(ImageDialog, {
          onClose: vi.fn(),
          onSend: vi.fn(),
          onPickFromCanvas,
          onPickFromAssets,
          ...props,
        })
      ),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
  return { onPickFromCanvas, onPickFromAssets };
}

const actionBar = () => container.querySelector(`.${barStyles.actionBar}`);
const attachmentStrip = () => container.querySelector(`.${dialogStyles.previewRow}`);
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

const imageFile = (id: string): UploadedFile => ({ id, url: `https://x/${id}.png`, type: 'image', name: `图${id}` });

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKGB7U 附件操作条渲染与位置', () => {
  it('操作条为第一行：左「+ 参考」「资产库」pill，右侧并入展开/关闭按钮', async () => {
    await renderDialog();

    const bar = actionBar()!;
    expect(bar).toBeTruthy();
    const actions = bar.querySelector(`.${barStyles.actions}`)!;
    expect(actions.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_CANVAS_TITLE}"]`)).toBeTruthy();
    expect(actions.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_ASSETS_TITLE}"]`)).toBeTruthy();
    const trailing = bar.querySelector(`.${barStyles.trailing}`)!;
    expect(trailing.querySelector('button[title="展开"]')).toBeTruthy();
    expect(trailing.querySelector('button[title="关闭"]')).toBeTruthy();
    const editor = container.querySelector('[contenteditable]')!;
    expect(bar.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('无附件时附件栏整条不渲染（操作条 + 输入框两段）', async () => {
    await renderDialog();
    expect(attachmentStrip()).toBeNull();
    expect(actionBar()).toBeTruthy();
  });

  it('有附件时附件栏出现在操作条与输入框之间；删光后重新隐藏', async () => {
    await renderDialog({ initialFiles: [imageFile('f1')] });

    const bar = actionBar()!;
    const strip = attachmentStrip()!;
    expect(strip).toBeTruthy();
    const editor = container.querySelector('[contenteditable]')!;
    expect(bar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await click(strip.querySelector('button[title="移除"]')!);
    expect(attachmentStrip()).toBeNull();
  });

  it('仅文本附件时附件栏同样出现（空态由实际附件项派生）', async () => {
    await renderDialog({ attachments: [{ nodeId: 't1', title: '故事文案', text: '一只蓝鲸在海里' }] });
    expect(attachmentStrip()).toBeTruthy();
    expect(attachmentStrip()!.querySelector('[data-testid="dock-text-ref"]')).toBeTruthy();
  });
});

describe('IKGB7U 两类点击分派（等价退役菜单两项）', () => {
  it('点「+ 参考」分派 onPickFromCanvas（画布点选），点「资产库」分派 onPickFromAssets', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog();

    await click(pickCanvasBtn());
    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
    expect(onPickFromAssets).not.toHaveBeenCalled();

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

describe('IKGB7U 禁用态：常显置灰 + 悬停原因（替代入口消失）', () => {
  it('附件达上限：两按钮 aria-disabled、悬停说明已达上限，点击不分派', async () => {
    const files = Array.from({ length: 10 }, (_, i) => imageFile(`f${i}`));
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({ initialFiles: files });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('参考图片最多 10 张，已达上限');
    }
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
  });

  it('生成中只读：两按钮 aria-disabled、悬停说明生成中只读，点击不分派', async () => {
    const { onPickFromCanvas, onPickFromAssets } = await renderDialog({
      draftBinding: { status: 'generating', onParamsChange: vi.fn() },
    });

    for (const btn of [pickCanvasBtn(), pickAssetsBtn()]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('生成中，参数与连线只读；可在画布卡片上取消生成');
    }
    await click(pickCanvasBtn());
    await click(pickAssetsBtn());
    expect(onPickFromCanvas).not.toHaveBeenCalled();
    expect(onPickFromAssets).not.toHaveBeenCalled();
  });

  it('未达上限且非只读：按钮可用且悬停为入口语义', async () => {
    await renderDialog({ initialFiles: [imageFile('f1')] });
    expect(pickCanvasBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickAssetsBtn().getAttribute('aria-disabled')).toBeNull();
    expect(pickCanvasBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_CANVAS_TITLE);
    expect(pickAssetsBtn().getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_ASSETS_TITLE);
  });
});

describe('IKGB7U AttachmentActionBar 共享组件（三面板同源地基）', () => {
  it('kind/role 参数随点击透传宿主回调（视频首尾帧接入预留）', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onPickFromCanvas = vi.fn();
    const onPickFromAssets = vi.fn();
    await act(async () => {
      root.render(
        createElement(AttachmentActionBar, {
          kind: 'image',
          role: 'last',
          onPickFromCanvas,
          onPickFromAssets,
        }),
      );
    });

    await click(container.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_CANVAS_TITLE}"]`)!);
    expect(onPickFromCanvas).toHaveBeenCalledWith('image', 'last');
    await click(container.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_ASSETS_TITLE}"]`)!);
    expect(onPickFromAssets).toHaveBeenCalledWith('image', 'last');
  });
});
