// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/api/generation';
import BottomDialog from './index';
import styles from './index.module.css';

const { fetchGenerationModels } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
}));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels,
}));

vi.mock('../ChipTextEditor', () => ({
  default: () => createElement('textarea', { 'data-testid': 'chip-editor' }),
}));

const seedance: GenerationModel = {
  model_id: 'seedance',
  provider_id: 'p',
  model_label: 'Seedance 2.0',
  icon: null,
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p', width: null, height: null }],
  supported_aspect_ratios: ['16:9', '9:16'],
  supported_formats: ['mp4'],
  supported_durations: { min: 4, max: 15, step: 1 },
  default_size: '720p',
  default_format: 'mp4',
  default_aspect_ratio: '16:9',
  default_duration: 10,
  features: {
    reference_image: true,
    image_reference_max: 10,
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
  is_default: false,
  version: 1,
  digest: '',
};

const kling: GenerationModel = {
  ...seedance,
  model_id: 'kling',
  model_label: 'Kling',
};

let root: Root;
let mountNode: HTMLDivElement;

async function renderDialog(onClose = vi.fn()) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(BottomDialog, {
        onClose,
        onSend: vi.fn(),
        videoMediaRefs: { reference: [] },
        videoDraftBinding: { onParamsChange: vi.fn() },
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return onClose;
}

async function openConfigAndModelDropdown() {
  const configBtn = [...mountNode.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('16:9'),
  );
  expect(configBtn).toBeTruthy();
  await act(async () => {
    configBtn?.click();
  });
  expect(mountNode.textContent).toContain('模型与质量');

  const modelBtn = [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.selectBtn}`)].find((button) =>
    button.textContent?.includes('Seedance 2.0'),
  );
  expect(modelBtn).toBeTruthy();
  await act(async () => {
    modelBtn?.click();
  });
  expect(mountNode.querySelector(`.${styles.selectDropdown}`)).not.toBeNull();
  expect(mountNode.textContent).toContain('Kling');
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchGenerationModels.mockResolvedValue([seedance, kling]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('BottomDialog nested overlays (IKBO6M)', () => {
  it('closes the model dropdown and 模型与质量 panel on canvas blank press, keeping the host dialog', async () => {
    const onClose = await renderDialog();
    await openConfigAndModelDropdown();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(mountNode.querySelector(`.${styles.selectDropdown}`)).toBeNull();
    expect(mountNode.querySelector(`.${styles.configPanel}`)).toBeNull();
    expect(mountNode.textContent).not.toContain('模型与质量');
    expect(mountNode.querySelector(`.${styles.dialog}`)).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the 模型与质量 panel on canvas blank press even when no dropdown is open', async () => {
    const onClose = await renderDialog();
    const configBtn = [...mountNode.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('16:9'),
    );
    await act(async () => {
      configBtn?.click();
    });
    expect(mountNode.querySelector(`.${styles.configPanel}`)).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(mountNode.querySelector(`.${styles.configPanel}`)).toBeNull();
    expect(mountNode.querySelector(`.${styles.dialog}`)).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* IKEOLP：配置面板挂在 .dialog 滚动框之外的定位外壳 .dialogWrap 上——
   若面板回到 overflow 容器内部，顶部会再次被裁剪（滚动容器顶部负向溢出不可滚动到达） */
describe('BottomDialog 配置面板裁剪（IKEOLP）', () => {
  it('配置面板不是滚动对话框 .dialog 的后代，而是挂在定位外壳上', async () => {
    await renderDialog();
    const configBtn = [...mountNode.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('16:9'),
    );
    expect(configBtn).toBeTruthy();
    await act(async () => {
      configBtn?.click();
    });

    const panel = mountNode.querySelector(`.${styles.configPanel}`);
    const dialog = mountNode.querySelector(`.${styles.dialog}`);
    expect(panel).not.toBeNull();
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(panel)).toBe(false);
    expect(panel?.closest(`.${styles.dialogWrap}`)).not.toBeNull();
  });
});

/* IKGBTV：宽高比示意图标接入共享 RatioIcon——竖屏比例必须渲染为竖向矩形（16px 上限） */
describe('BottomDialog 宽高比图标（IKGBTV）', () => {
  it('竖屏比例 9:16 的图标为 9×16 竖向矩形，横竖不反且不超 16px 上限', async () => {
    await renderDialog();
    const configBtn = [...mountNode.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('16:9'),
    );
    await act(async () => {
      configBtn?.click();
    });

    const ratioBtn = [...mountNode.querySelectorAll(`.${styles.ratioGroup} button`)].find((button) =>
      button.textContent?.includes('9:16'),
    );
    expect(ratioBtn).toBeTruthy();
    const icon = ratioBtn?.querySelector('span') as HTMLElement;
    expect(icon.style.width).toBe('9px');
    expect(icon.style.height).toBe('16px');
  });
});
