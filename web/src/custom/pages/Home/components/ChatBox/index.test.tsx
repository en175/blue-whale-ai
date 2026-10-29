// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/custom/api/generation';
import ChatBox from './index';
import styles from './index.module.css';
import { OMNI_REFERENCE_FOLLOW_HINT } from '@/custom/utils/video-reference-hints';


const { fetchGenerationModels, navigate, pickerOnSelect } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
  navigate: vi.fn(),
  pickerOnSelect: { current: null as null | ((assets: unknown[]) => void) },
}));

vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: '/', search: '', state: null }) }));

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

async function renderChatBox(props: { workspace?: 'create' | 'canvas' } = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(ChatBox, { draft: null, ...props }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
}

async function openModeOptions(): Promise<string[]> {
  const trigger = mountNode.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  await act(async () => { trigger.click(); });
  return [...mountNode.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map((el) => el.textContent ?? '');
}

async function switchMode(label: string) {
  const trigger = mountNode.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  await act(async () => { trigger.click(); });
  const option = [...mountNode.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
    (el) => el.textContent?.startsWith(label),
  )!;
  await act(async () => { option.click(); });
}

async function openPreference() {
  const trigger = [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-haspopup') === 'dialog',
  )!;
  await act(async () => { trigger.click(); });
  return mountNode.querySelector<HTMLElement>('[role="dialog"][aria-label="生成偏好"]')!;
}

async function choosePreferenceValue(fieldLabel: string, valueLabel: string) {
  await openPreference();
  const dialog = mountNode.querySelector<HTMLElement>('[role="dialog"][aria-label="生成偏好"]')!;
  const label = [...dialog.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === fieldLabel)!;
  const field = label.parentElement!;
  const option = [...field.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === valueLabel)!;
  await act(async () => { option.click(); });
}

function refCard(): HTMLDivElement {
  return mountNode.querySelector<HTMLDivElement>(`.${styles.refCard}`)!;
}

async function switchToVideoTabAndInject(assets: unknown[]) {
  await switchMode('视频');
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
    await switchMode('视频');
    await choosePreferenceValue('生成模式', '首尾帧');
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
  it('生成偏好里 adaptive 档显示 auto 且无 adaptive 黑话，选中后摘要同文案', async () => {
    await renderChatBox();
    await switchMode('视频');
    await openPreference();

    const dialog = mountNode.querySelector<HTMLElement>('[role="dialog"][aria-label="生成偏好"]')!;
    expect(dialog.textContent).not.toContain('adaptive');

    const ratioLabel = [...dialog.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === '画面比例')!;
    const autoOption = [...ratioLabel.parentElement!.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'auto')!;
    expect(autoOption).toBeTruthy();

    await act(async () => { autoOption.click(); });
    const trigger = [...mountNode.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.getAttribute('aria-haspopup') === 'dialog')!;
    expect(trigger.textContent).toContain('auto');
  });
});

describe('IKLUVP 首页延长时长', () => {
  it('生成偏好含时长项，选项来自当前模型能力', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    await renderChatBox();
    await switchMode('视频');
    await openPreference();

    const dialog = mountNode.querySelector<HTMLElement>('[role="dialog"][aria-label="生成偏好"]')!;
    const label = [...dialog.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === '时长')!;
    const options = [...label.parentElement!.querySelectorAll('button')].map((b) => b.textContent);
    expect(options).toContain('5s');
    expect(options.every((option) => /^(\d+s|自动)$/.test(option ?? ''))).toBe(true);
  });
});

describe('V1.3.0 首页输入区模式', () => {
  it('生成方式下模式下拉提供 Agent/图片/视频，主切换不在输入区内', async () => {
    await renderChatBox();
    const options = await openModeOptions();

    expect(options).toEqual(['Agent 模式', '图片生成', '视频生成']);
    expect(buttonByLabel('生成')).toBeUndefined();
    expect(buttonByLabel('画布')).toBeUndefined();
    expect(mountNode.textContent).not.toContain('视频智能体');
    expect(mountNode.textContent).not.toContain('AI 视频');
  });

  it('画布方式下不提供 Agent 模式', async () => {
    await renderChatBox({ workspace: 'canvas' });
    const options = await openModeOptions();
    expect(options).toEqual(['图片生成', '视频生成']);
  });

  it('空白输入时发送按钮禁用', async () => {
    await renderChatBox();

    const textarea = mountNode.querySelector('textarea')!;
    const send = mountNode.querySelector<HTMLButtonElement>(`button[class*="sendBtn"]`)!;
    expect(send.disabled).toBe(true);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '  ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(mountNode.querySelector<HTMLButtonElement>(`button[class*="sendBtn"]`)!.disabled).toBe(true);
  });
});
