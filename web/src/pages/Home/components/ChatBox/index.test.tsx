// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/api/generation';
import ChatBox from './index';
import styles from './index.module.css';
import { OMNI_REFERENCE_FOLLOW_HINT } from '@/lib/video-reference-hints';

/* IKJ794：首页输入框（ChatBox）全能参考被动提示与 adaptive 档「Auto」文案。
   与画布 BottomDialog（videoRefArea.test.tsx）同条件同文案：显示条件 = 全能参考模式 +
   Seedance 2.5（supported_aspect_ratios 含 adaptive）+ 已挂 ≥1 参考视频，与提示词内容无关
   （前端零关键词判定）。参考素材经资产选择弹窗注入（File 上传在 jsdom 中不可驱动）。 */

const { fetchGenerationModels, navigate, pickerOnSelect } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
  navigate: vi.fn(),
  /** AssetsPickerModal 打桩：渲染时登记最新 onSelect，测试直接注入资产 */
  pickerOnSelect: { current: null as null | ((assets: unknown[]) => void) },
}));

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('@/utils/auth', () => {
  /** useSyncExternalStore 快照必须引用稳定（每次新对象会无限重渲） */
  const user = { id: 'u1', name: 'tester' };
  return {
    getCurrentUser: () => user,
    subscribe: () => () => {},
  };
});

vi.mock('@/api/projects', () => ({ createProject: vi.fn() }));

vi.mock('../SkillModal', () => ({ default: () => null }));
vi.mock('@/components/LoginModal', () => ({ default: () => null }));

vi.mock('@/pages/CanvasPage/components/AssetsPickerModal', async () => {
  const { useEffect } = await import('react');
  /** 具名组件（大写开头）满足 rules-of-hooks；渲染时登记最新 onSelect，测试直接注入资产 */
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
  audio: false,
};

/** Seedance 2.5：比例表含 adaptive（组件判定锚点），支持视频参考 */
const seedance25: GenerationModel = {
  model_id: 'seedance-2.5',
  provider_id: 'p',
  model_label: 'Seedance 2.5',
  icon: null,
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p', width: null, height: null }],
  supported_aspect_ratios: ['adaptive', '16:9', '9:16'],
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

/** Seedance 2.0：比例表无 adaptive，行为维持现状 */
const seedance20: GenerationModel = {
  ...seedance25,
  model_id: 'seedance-2.0',
  model_label: 'Seedance 2.0',
  supported_aspect_ratios: ['16:9', '9:16'],
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

/** 按文案找按钮（tab/参数/菜单项通用） */
function buttonByLabel(label: string): HTMLButtonElement {
  return [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
}

/** 参考/附件添加卡（div 而非 button）：按样式类精确定位 */
function refCard(): HTMLDivElement {
  return mountNode.querySelector<HTMLDivElement>(`.${styles.refCard}`)!;
}

/** 切到 AI 视频 tab 并经「参考 → 从资产中选择」注入资产（需登录态，已 mock） */
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
    await act(async () => { buttonByLabel('全能参考').click(); });
    await act(async () => { buttonByLabel('首尾帧').click(); });
    // 首帧槽位经「首帧 → 从资产中选择」注入图片
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
    // 比例按钮显示当前选中档（默认 16:9）；RatioIcon 渲染为 span，不影响文案断言
    const ratioBtn = [...mountNode.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '16:9')!;
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
