// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ApiError } from '@/shared/api/http';
import type { GenerationModel } from '@/custom/api/generation';
import ChatBox from './index';
import styles from './index.module.css';
import { OMNI_REFERENCE_FOLLOW_HINT } from '@/custom/utils/video-reference-hints';


const { fetchGenerationModels, navigate, pickerOnSelect, createProject, fetchProjectListQuery, authUser } = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(),
  navigate: vi.fn(),
  pickerOnSelect: { current: null as null | ((assets: unknown[]) => void) },
  createProject: vi.fn(),
  fetchProjectListQuery: vi.fn(),
  authUser: { current: { id: 'u1', userId: 1, name: 'tester' } as { id: string; userId: number; name: string } | null },
}));

vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: '/', search: '', state: null }) }));

vi.mock('@/shared/utils/auth', () => ({
  getCurrentUser: () => authUser.current,
  subscribe: () => () => {},
}));

vi.mock('@/custom/api/projects', () => ({ createProject, fetchProjectListQuery }));

vi.mock('../SkillModal', () => ({
  default: ({ open, onUseSkill }: { open: boolean; onUseSkill?: (skill: unknown) => void }) =>
    open
      ? createElement(
          'div',
          { role: 'dialog', 'aria-label': '技能库' },
          createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'use-skill',
              onClick: () =>
                onUseSkill?.({ creative_skill_id: 'skill-1', name: '电影技法工具箱', asset_domain: 'official' }),
            },
            '直接使用',
          ),
        )
      : null,
}));
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
  authUser.current = { id: 'u1', userId: 1, name: 'tester' };
  fetchGenerationModels.mockResolvedValue([seedance25, seedance20]);
  createProject.mockReset();
  fetchProjectListQuery.mockReset();
  fetchProjectListQuery.mockResolvedValue({ records: [], total: 0, size: 30, current: 1 });
  sessionStorage.clear();
  navigate.mockReset();
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

    const ratioLabel = [...dialog.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === '宽高比')!;
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
  it('生成偏好时长滑块范围来自当前模型能力', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    await renderChatBox();
    await switchMode('视频');
    await openPreference();

    const dialog = mountNode.querySelector<HTMLElement>('[role="dialog"][aria-label="生成偏好"]')!;
    const head = [...dialog.querySelectorAll<HTMLElement>('span')].find((el) => el.textContent === '时长')!;
    expect(head.parentElement!.textContent).toContain('10s');

    const slider = dialog.querySelector<HTMLElement>('[role="slider"]')!;
    expect(slider.getAttribute('aria-valuemin')).toBe('4');
    expect(slider.getAttribute('aria-valuemax')).toBe('15');
    expect(dialog.textContent).toContain('15s');
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

  it('画布方式下输入框收起，点击后展开完整输入区且不提供 Agent 模式', async () => {
    await renderChatBox({ workspace: 'canvas' });
    expect(mountNode.querySelector<HTMLElement>('[data-testid="home-composer"]')?.className).toContain('collapsed');
    expect(mountNode.querySelector('button[aria-haspopup="menu"]')).toBeNull();
    expect(mountNode.querySelector('button[aria-haspopup="dialog"]')).toBeNull();

    await act(async () => {
      mountNode.querySelector<HTMLTextAreaElement>('[data-testid="home-composer"] textarea')!.focus();
    });
    expect(mountNode.querySelector<HTMLElement>('[data-testid="home-composer"]')?.className).not.toContain('collapsed');
    expect(mountNode.querySelector('button[aria-haspopup="dialog"]')).not.toBeNull();

    const options = await openModeOptions();
    expect(options).toEqual(['图片生成', '视频生成']);
  });

  it('切回生成方式时输入框恢复完整状态', async () => {
    await renderChatBox({ workspace: 'canvas' });
    await act(async () => {
      mountNode.querySelector<HTMLTextAreaElement>('[data-testid="home-composer"] textarea')!.focus();
    });
    await act(async () => {
      root.render(createElement(ChatBox, { draft: null, workspace: 'create' }));
    });
    expect(mountNode.querySelector<HTMLElement>('[data-testid="home-composer"]')?.className).not.toContain('collapsed');
    expect(mountNode.querySelector('button[aria-haspopup="menu"]')).not.toBeNull();
  });

  it('点击聊天窗口外区域重新收起', async () => {
    await renderChatBox({ workspace: 'canvas' });
    await act(async () => {
      mountNode.querySelector<HTMLTextAreaElement>('[data-testid="home-composer"] textarea')!.focus();
    });
    expect(mountNode.querySelector<HTMLElement>('[data-testid="home-composer"]')?.className).not.toContain('collapsed');

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(mountNode.querySelector<HTMLElement>('[data-testid="home-composer"]')?.className).toContain('collapsed');
  });

  it('点击聊天窗口内部（含弹出的面板）不收起', async () => {
    await renderChatBox({ workspace: 'canvas' });
    await act(async () => {
      mountNode.querySelector<HTMLTextAreaElement>('[data-testid="home-composer"] textarea')!.focus();
    });

    const summary = [...mountNode.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-haspopup') === 'dialog',
    )!;
    await act(async () => { summary.click(); });
    const panel = mountNode.querySelector<HTMLElement>('[role="dialog"][aria-label="生成偏好"]')!;

    await act(async () => {
      panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(mountNode.querySelector<HTMLElement>('[data-testid="home-composer"]')?.className).not.toContain('collapsed');
  });

  it('技能入口文案为「技能库」，Agent 模式不展示模型选择', async () => {
    await renderChatBox();

    expect(mountNode.textContent).toContain('技能库');
    expect(mountNode.textContent).not.toContain('Skill');
    expect(mountNode.querySelector('[aria-label="选择生成模型"]')).toBeNull();
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

  it('发送按钮左侧常驻预计消耗积分位，未接入报价时不显示数字', async () => {
    await renderChatBox();
    await switchMode('图片');

    const quote = mountNode.querySelector<HTMLElement>('[data-testid="home-quote"]')!;
    expect(quote).not.toBeNull();
    expect(quote.querySelector('svg')).not.toBeNull();
    expect(quote.textContent ?? '').toBe('');
  });

  it('Agent 模式不展示积分位，图片与视频模式展示', async () => {
    await renderChatBox();
    expect(mountNode.querySelector('[data-testid="home-quote"]')).toBeNull();

    await switchMode('图片');
    expect(mountNode.querySelector('[data-testid="home-quote"]')).not.toBeNull();

    await switchMode('视频');
    expect(mountNode.querySelector('[data-testid="home-quote"]')).not.toBeNull();
  });
});

function typePrompt(value: string) {
  const textarea = mountNode.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(textarea, value);
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function sendButton(): HTMLButtonElement {
  return mountNode.querySelector<HTMLButtonElement>(`button[class*="sendBtn"]`)!;
}

describe('IKR63N 参考展示与技能指令', () => {
  it('参考入口在缩略图之前，缩略图在入口右侧', async () => {
    await renderChatBox();
    await switchMode('视频');
    await act(async () => { refCard().click(); });
    const fromAssets = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '从资产中选择')!;
    await act(async () => { fromAssets.click(); });
    await act(async () => { pickerOnSelect.current!([imageAsset]); });

    const area = mountNode.querySelector<HTMLElement>(`.${styles.refArea}`)!;
    const first = area.firstElementChild as HTMLElement;
    expect(first.className).toContain(styles.refCard);
    expect(first.textContent).toContain('参考');
  });

  it('点击图片缩略图打开大图预览，Esc 关闭', async () => {
    await renderChatBox();
    await switchToVideoTabAndInject([imageAsset]);

    const thumb = mountNode.querySelector<HTMLImageElement>(`.${styles.refThumb} img`)!;
    await act(async () => { thumb.click(); });
    const overlay = document.body.querySelector<HTMLElement>('[aria-label="参考图预览"]');
    expect(overlay).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(document.body.querySelector('[aria-label="参考图预览"]')).toBeNull();
  });

  it('移除缩略图不打开预览', async () => {
    await renderChatBox();
    await switchToVideoTabAndInject([imageAsset]);

    const remove = mountNode.querySelector<HTMLButtonElement>(`.${styles.refThumbRemove}`)!;
    await act(async () => { remove.click(); });
    expect(document.body.querySelector('[aria-label="参考图预览"]')).toBeNull();
    expect(mountNode.querySelector(`.${styles.refThumb}`)).toBeNull();
  });

  it('正文开头键入 / 打开技能库，继续输入不清空正文', async () => {
    await renderChatBox();
    await act(async () => { typePrompt('/'); });

    expect(mountNode.querySelector('[role="dialog"][aria-label="技能库"]')).not.toBeNull();

    await act(async () => { typePrompt('/帮我做一条宣传片'); });
    expect((mountNode.querySelector('textarea') as HTMLTextAreaElement).value).toBe('/帮我做一条宣传片');
    expect(sendButton().disabled).toBe(false);
  });

  it('网址中的斜杠不触发技能库', async () => {
    await renderChatBox();
    await act(async () => { typePrompt('参考 https://example.com/a 的风格'); });

    expect(mountNode.querySelector('[role="dialog"][aria-label="技能库"]')).toBeNull();
  });

  it('直接使用技能后首页展示技能名称', async () => {
    await renderChatBox();
    await act(async () => { typePrompt('/'); });

    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="use-skill"]')!.click();
      await Promise.resolve();
    });

    const chip = mountNode.querySelector<HTMLElement>(`.${styles.armedSkill}`);
    expect(chip?.textContent).toContain('电影技法工具箱');
    expect(chip?.textContent).not.toBe('技能');
  });
});

describe('IKR63U 首页发送只提交一次', () => {
  it('创建中连点发送只创建一个项目，按钮锁定', async () => {
    createProject.mockImplementation(() => new Promise(() => {}));
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });
    expect(sendButton().disabled).toBe(false);

    await act(async () => { sendButton().click(); });
    expect(sendButton().disabled).toBe(true);
    await act(async () => { sendButton().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it('创建项目失败时保留正文，不跳转画布，明确失败直接提示后端文案', async () => {
    createProject.mockRejectedValue(new ApiError(400, '项目名不合法'));
    const toastSpy = vi.spyOn(toast, 'error');
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });

    await act(async () => { sendButton().click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect((mountNode.querySelector('textarea') as HTMLTextAreaElement).value).toBe('画一只猫');
    expect(sendButton().disabled).toBe(false);
    expect(toastSpy).toHaveBeenCalledWith('项目名不合法');
    expect(mountNode.querySelector('[data-testid="create-check-bar"]')).toBeNull();
    expect(sessionStorage.getItem('bw:home:create-attempt')).toBeNull();
    toastSpy.mockRestore();
  });

  it('创建项目成功后跳到新画布，首页正文清空', async () => {
    createProject.mockResolvedValue({ id: 'p9', name: 'x' });
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });

    await act(async () => { sendButton().click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(navigate).toHaveBeenCalledWith('/canvas?project=p9', {
      state: expect.objectContaining({ agentText: '画一只猫', agentAutoSend: true }),
    });
    expect((mountNode.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });
});

function quoteBadge() {
  return mountNode.querySelector<HTMLElement>('[data-testid="home-quote"]')!;
}

describe('IKST39 创建结果不明的核对', () => {
  function recentRecord(id: string, name: string, createdAt: string) {
    return {
      id,
      name,
      previews: [],
      created_at: createdAt,
      last_opened_at: null,
      last_edited_at: createdAt,
      pinned_at: null,
    };
  }

  it('超时视为结果不明：不解锁发送，显示核对提示', async () => {
    createProject.mockRejectedValue(new ApiError(408, '请求超时，请稍后重试'));
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });

    await act(async () => { sendButton().click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(navigate).not.toHaveBeenCalled();
    expect(sendButton().disabled).toBe(true);
    expect(mountNode.querySelector('[data-testid="create-check-bar"]')?.textContent).toContain('核对');
    expect((mountNode.querySelector('textarea') as HTMLTextAreaElement).value).toBe('画一只猫');
    expect(JSON.parse(sessionStorage.getItem('bw:home:create-attempt')!).unsure).toBe(true);
  });

  it('核对发现已创建：跳到原项目并清空尝试', async () => {
    createProject.mockRejectedValue(new ApiError(408, '请求超时，请稍后重试'));
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });
    await act(async () => { sendButton().click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const attemptName = JSON.parse(sessionStorage.getItem('bw:home:create-attempt')!).name as string;
    fetchProjectListQuery.mockResolvedValue({
      records: [recentRecord('p1', attemptName, new Date().toISOString())],
      total: 1,
      size: 30,
      current: 1,
    });
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="create-check-retry"]')!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledWith('/canvas?project=p1', { state: { agentText: '画一只猫', skillId: '', skillName: '', agentAutoSend: true } });
    expect(sessionStorage.getItem('bw:home:create-attempt')).toBeNull();
  });

  it('核对确认未创建：才解锁发送，仍保留正文', async () => {
    createProject.mockRejectedValue(new ApiError(0, '网络请求失败，请检查网络后重试'));
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });
    await act(async () => { sendButton().click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(sendButton().disabled).toBe(true);

    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="create-check-retry"]')!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(sendButton().disabled).toBe(false);
    expect(mountNode.querySelector('[data-testid="create-check-bar"]')?.textContent).toContain('已确认未创建');
    expect((mountNode.querySelector('textarea') as HTMLTextAreaElement).value).toBe('画一只猫');
  });

  it('核对接口也不可达：保持锁定并保留尝试', async () => {
    createProject.mockRejectedValue(new ApiError(408, '请求超时，请稍后重试'));
    fetchProjectListQuery.mockRejectedValue(new ApiError(502, '网关错误'));
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });
    await act(async () => { sendButton().click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="create-check-retry"]')!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sendButton().disabled).toBe(true);
    expect(mountNode.querySelector('[data-testid="create-check-bar"]')?.textContent).toContain('无法核对');
    expect(sessionStorage.getItem('bw:home:create-attempt')).not.toBeNull();
  });

  it('打开页面时自动核对未完成的创建，已创建直接进原项目', async () => {
    const startedAt = Date.now() - 60_000;
    sessionStorage.setItem('bw:home:create-attempt', JSON.stringify({
      id: 'key-1',
      name: '2026-11-05 10:00',
      userId: 1,
      startedAt,
      unsure: true,
      absent: false,
      state: null,
    }));
    fetchProjectListQuery.mockResolvedValue({
      records: [recentRecord('p7', '2026-11-05 10:00', new Date(startedAt + 1000).toISOString())],
      total: 1,
      size: 30,
      current: 1,
    });

    await renderChatBox();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(fetchProjectListQuery).toHaveBeenCalledWith({ source: 'dialog' });
    expect(navigate).toHaveBeenCalledWith('/canvas?project=p7', { state: null });
    expect(sessionStorage.getItem('bw:home:create-attempt')).toBeNull();
  });
});

describe('IKST39 创建尝试匹配', () => {
  it('只认创建时间在尝试之后的同名项目', async () => {
    const { matchCreatedProject } = await import('./createAttempt');
    const base = {
      previews: [],
      last_opened_at: null,
      last_edited_at: '',
      pinned_at: null,
    };
    const attempt = {
      id: 'k',
      name: 'A',
      userId: 1,
      startedAt: 1_700_000_000_000,
      unsure: true,
      absent: false,
      state: null,
    };
    const old = { ...base, id: 'old', name: 'A', created_at: new Date(attempt.startedAt - 60_000).toISOString() };
    const fresh = { ...base, id: 'new', name: 'A', created_at: new Date(attempt.startedAt + 1_000).toISOString() };

    expect(matchCreatedProject([old], attempt)).toBeNull();
    expect(matchCreatedProject([old, fresh], attempt)?.id).toBe('new');
  });

  it('重名时按带后缀的项目兜底', async () => {
    const { matchCreatedProject } = await import('./createAttempt');
    const attempt = {
      id: 'k',
      name: 'A',
      userId: 1,
      startedAt: 1_700_000_000_000,
      unsure: true,
      absent: false,
      state: null,
    };
    const suffixed = {
      id: 's',
      name: 'A (2)',
      previews: [],
      created_at: new Date(attempt.startedAt + 500).toISOString(),
      last_opened_at: null,
      last_edited_at: '',
      pinned_at: null,
    };

    expect(matchCreatedProject([suffixed], attempt)?.id).toBe('s');
  });
});

function requestsToQuoteApi(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/api/generation-quotes'));
}

async function settleQuote() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('IKR63N 首页积分预估接线', () => {
  let quoteFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    quoteFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 200, msg: null, data: { credits: 128 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    );
    vi.stubGlobal('fetch', quoteFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('视频页签带完整参数请求预估并显示数字', async () => {
    await renderChatBox();
    await switchMode('视频');
    await settleQuote();

    expect(quoteBadge().textContent).toBe('128');

    const [url, init] = quoteFetch.mock.calls.find(([u]) => String(u).includes('/api/generation-quotes'))! as [string, RequestInit];
    expect(url).toBe('/api/generation-quotes');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      type: 'video',
      parameters: { model_id: 'seedance-2.5', mode: 'text2video', resolution: '720p', duration: 10 },
      references: [],
    });
  });

  it('Agent 模式不展示积分位，也不请求报价', async () => {
    await renderChatBox();
    await act(async () => { typePrompt('画一只猫'); });
    await settleQuote();

    expect(requestsToQuoteApi(quoteFetch)).toHaveLength(0);
    expect(mountNode.querySelector('[data-testid="home-quote"]')).toBeNull();
  });

  it('未登录不请求', async () => {
    authUser.current = null;
    await renderChatBox();
    await switchMode('视频');
    await settleQuote();

    expect(requestsToQuoteApi(quoteFetch)).toHaveLength(0);
    expect(quoteBadge().textContent).toBe('');
  });

  it('计费服务失败时只显示图标，不弹提示', async () => {
    fetchGenerationModels.mockResolvedValue([{ ...seedance25, model_id: 'seedance-quote-error' }]);
    quoteFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ code: 500100, msg: '计费异常', data: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    await renderChatBox();
    await switchMode('视频');
    await settleQuote();

    expect(quoteBadge().textContent).toBe('');
    expect(document.body.textContent).not.toContain('计费异常');
    expect((mountNode.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('提示词变化防抖：停手后才按新提示词请求一次', async () => {
    await renderChatBox();
    await switchMode('视频');
    await settleQuote();
    const before = requestsToQuoteApi(quoteFetch).length;

    await act(async () => { typePrompt('海边日落'); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(requestsToQuoteApi(quoteFetch)).toHaveLength(before);

    await settleQuote();
    expect(requestsToQuoteApi(quoteFetch)).toHaveLength(before + 1);
    const lastBody = JSON.parse((quoteFetch.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(lastBody.parameters.prompt).toBe('海边日落');
  });
});
