// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/custom/api/generation';
import ChatBox from './index';
import styles from './index.module.css';
import { OMNI_REFERENCE_FOLLOW_HINT } from '@/custom/utils/video-reference-hints';
import { clickSelectOption, selectOptionByText } from '@/custom/pages/CanvasPage/testing/radixSelect';


const { fetchGenerationModels, navigate, pickerOnSelect } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
  navigate: vi.fn(),
  pickerOnSelect: { current: null as null | ((assets: unknown[]) => void) },
}));

vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('@/shared/utils/auth', () => {
  const user = { id: 'u1', name: 'tester' };
  return {
    getCurrentUser: () => user,
    subscribe: () => () => {},
  };
});

vi.mock('@/custom/api/projects', () => ({ createProject: vi.fn() }));

vi.mock('../SkillModal', () => ({ default: () => null }));
vi.mock('@/custom/components/LoginModal', () => ({ default: () => null }));

vi.mock('@/custom/pages/CanvasPage/components/AssetsPickerModal', async () => {
  const { useEffect } = await import('react');
  function PickerStub({ onSelect }: { onSelect: (assets: unknown[]) => void }) {
    useEffect(() => { pickerOnSelect.current = onSelect; });
    return null;
  }
  return { default: PickerStub };
});

const baseFeatures = {
  reference_image: true,
  image_reference_max: 10,
  video_reference: true,
  video_reference_max: 3,
  watermark: false,
  quantity_max: 1,
  sequential_image_generation: false,
  stream: false,
  tools: false,
  first_frame: true,
  last_frame: true,
  first_last_frame: true,
  task_types: {
    text2video: {},
    omni: {},
    image_reference: {},
    first_frame: {},
    first_last_frame: {},
  },
  audio: false,
};

const seedance25: GenerationModel = {
  model_id: 'seedance-2.5',
  provider_id: 'p',
  model_label: 'Seedance 2.5',
  icon: null,
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p', width: null, height: null }],
  supported_aspect_ratios: [{ id: 'adaptive', label: 'adaptive' }, { id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
  supported_formats: ['mp4'],
  supported_durations: { min: 4, max: 15, step: 1 },
  default_size: '720p',
  default_format: 'mp4',
  default_aspect_ratio: '16:9',
  default_duration: 10,
  features: baseFeatures,
  is_default: false,
  version: 1,
  digest: '',
};

const seedance20: GenerationModel = {
  ...seedance25,
  model_id: 'seedance-2.0',
  model_label: 'Seedance 2.0',
  supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
};

const videoAsset = { id: 1, type: 'video', url: 'http://x/v.mp4', width: null, height: null, duration: 5, size: null, source: 'uploaded' };
const imageAsset = { id: 2, type: 'image', url: 'http://x/i.png', width: null, height: null, duration: null, size: null, source: 'uploaded' };

let root: Root;
let mountNode: HTMLDivElement;

async function renderChatBox() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(ChatBox, { draft: null }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
}

function refCard(): HTMLDivElement {
  return mountNode.querySelector<HTMLDivElement>(`.${styles.refCard}`)!;
}

async function switchToVideoTabAndInject(assets: unknown[]) {
  await act(async () => { buttonByLabel('AI 视频').click(); });
  await act(async () => { refCard().click(); });
  const fromAssets = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => b.textContent === '从资产中选择')!;
  await act(async () => { fromAssets.click(); });
  expect(pickerOnSelect.current).toBeTruthy();
  await act(async () => { pickerOnSelect.current!(assets); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchGenerationModels.mockResolvedValue([seedance25, seedance20]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('IKJ794 全能参考被动提示行（ChatBox）', () => {
  it('Seedance 2.5 + 全能参考 + 挂参考视频 → 显示提示（与 BottomDialog 同文案）', async () => {
    await renderChatBox();
    await switchToVideoTabAndInject([videoAsset]);
    expect(mountNode.textContent).toContain(OMNI_REFERENCE_FOLLOW_HINT);
  });

  it('首尾帧模式 → 不显示（首帧挂图片也不显示）', async () => {
    await renderChatBox();
    await act(async () => { buttonByLabel('AI 视频').click(); });
    await act(async () => { buttonByLabel('文生视频').click(); });
    await act(async () => {
      selectOptionByText('首尾帧')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => { buttonByLabel('首帧').click(); });
    const fromAssets = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '从资产中选择')!;
    await act(async () => { fromAssets.click(); });
    await act(async () => { pickerOnSelect.current!([imageAsset]); });
    expect(mountNode.textContent).not.toContain(OMNI_REFERENCE_FOLLOW_HINT);
  });

  it('Seedance 2.0 系列（比例表无 adaptive）+ 挂参考视频 → 不显示', async () => {
    fetchGenerationModels.mockResolvedValue([seedance20]);
    await renderChatBox();
    await switchToVideoTabAndInject([videoAsset]);
    expect(mountNode.textContent).not.toContain(OMNI_REFERENCE_FOLLOW_HINT);
  });

  it('全能参考 + 2.5 但只挂图片（未挂视频）→ 不显示', async () => {
    await renderChatBox();
    await switchToVideoTabAndInject([imageAsset]);
    expect(mountNode.textContent).not.toContain(OMNI_REFERENCE_FOLLOW_HINT);
  });
});

describe('IKJ794 adaptive 档文案（ChatBox，沿用上游 IKJ4W6 auto 显示名）', () => {
  it('比例下拉 adaptive 档显示 auto 且无 adaptive 黑话，选中后按钮同文案（取值与图标不变）', async () => {
    await renderChatBox();
    await act(async () => { buttonByLabel('AI 视频').click(); });
    const ratioBtn = [...mountNode.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'auto')!;
    expect(ratioBtn).toBeTruthy();
    await act(async () => { ratioBtn.click(); });
    const optionAuto = [...mountNode.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'auto')!;
    expect(optionAuto).toBeTruthy();
    expect([...mountNode.querySelectorAll('button')].some((b) => b.textContent === 'adaptive')).toBe(false);
    await act(async () => { optionAuto.click(); });
    expect(ratioBtn.textContent).toBe('auto');
  });
});


describe('IKLUVP 首页延长时长', () => {
  it('自动与指定秒数可切换，离开支持模式恢复正数', async () => {
    fetchGenerationModels.mockResolvedValue([{
      ...seedance25,
      features: { ...baseFeatures, task_types: { ...baseFeatures.task_types,
        edit: { allowed_ratios: ['adaptive'], allowed_durations: [-1] },
        extend: { allowed_ratios: ['adaptive'], allow_auto_duration: true },
      } },
    }]);
    await renderChatBox();
    await switchToVideoTabAndInject([videoAsset]);
    await act(async () => { buttonByLabel('视频编辑').click(); });
    await clickSelectOption('视频延长');
    expect(mountNode.textContent).not.toContain('跟随原视频');
    await act(async () => { buttonByLabel('⏱ 自动').click(); });
    const automatic = mountNode.querySelector<HTMLInputElement>('[aria-label="自动时长，由模型选择"]')!;
    expect(automatic.checked).toBe(true);
    await act(async () => { automatic.click(); });
    expect(mountNode.querySelector('[aria-label="时长秒数"]')).not.toBeNull();
    await act(async () => { automatic.click(); });
    expect(buttonByLabel('⏱ 自动')).toBeTruthy();
    await act(async () => { buttonByLabel('视频延长').click(); });
    await clickSelectOption('全能参考');
    expect(mountNode.textContent).not.toContain('⏱ 自动');
    expect(mountNode.textContent).not.toContain('-1s');
  });
});
