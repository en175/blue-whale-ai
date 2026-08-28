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
  supported_aspect_ratios: ['16:9'],
  supported_formats: ['mp4'],
  supported_durations: { min: 4, max: 15, step: 1 },
  default_size: '720p',
  default_format: 'mp4',
  default_aspect_ratio: '16:9',
  default_duration: 10,
  features: {
    reference_image: true,
    max_reference_images: 10,
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
