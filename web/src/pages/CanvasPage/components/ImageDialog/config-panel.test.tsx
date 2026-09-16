// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog from './index';
import styles from './index.module.css';

/* IKEOLP：配置面板挂在 .dialog 滚动框之外的定位外壳 .dialogWrap 上——
   若面板回到 overflow 容器内部，顶部会再次被裁剪（与 BottomDialog 同构修复） */

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'm-test',
      provider_id: 'prov',
      model_label: '测试生图模型',
      icon: null,
      supported_sizes: [{ id: '2k', label: '2K' }],
      supported_aspect_ratios: ['1:1', '3:4'],
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

async function renderDialog() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(ImageDialog, { onClose: vi.fn(), onSend: vi.fn() }));
  });
  // 等模型能力加载完成（底栏参数摘要按钮依赖 currentModel）
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('ImageDialog 配置面板裁剪（IKEOLP）', () => {
  it('配置面板不是滚动对话框 .dialog 的后代，而是挂在定位外壳上', async () => {
    await renderDialog();
    const configBtn = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('测试生图模型'),
    );
    expect(configBtn).toBeTruthy();
    await act(async () => {
      configBtn?.click();
    });

    const panel = container.querySelector(`.${styles.configPanel}`);
    const dialog = container.querySelector(`.${styles.dialog}`);
    expect(panel).not.toBeNull();
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(panel)).toBe(false);
    expect(panel?.closest(`.${styles.dialogWrap}`)).not.toBeNull();
  });
});

/* IKGBTV：宽高比示意图标接入共享 RatioIcon——竖屏比例必须渲染为竖向矩形（16px 上限） */
describe('ImageDialog 宽高比图标（IKGBTV）', () => {
  it('竖屏比例 3:4 的图标为 12×16 竖向矩形，横竖不反且不超 16px 上限', async () => {
    await renderDialog();
    const configBtn = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('测试生图模型'),
    );
    await act(async () => {
      configBtn?.click();
    });

    const ratioBtn = [...container.querySelectorAll(`.${styles.ratioGroup} button`)].find((button) =>
      button.textContent?.includes('3:4'),
    );
    expect(ratioBtn).toBeTruthy();
    const icon = ratioBtn?.querySelector('span') as HTMLElement;
    expect(icon.style.width).toBe('12px');
    expect(icon.style.height).toBe('16px');
  });
});
