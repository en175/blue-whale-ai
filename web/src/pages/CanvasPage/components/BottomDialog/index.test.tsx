// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationModel } from '@/api/generation';
import BottomDialog from './index';
import styles from './index.module.css';
import { typePromptRefText } from '../../testing/promptRefEditor';

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
/** 草稿参数回写 spy（每次 renderDialog 重置）——IKJ4W6 断言提交/落盘值仍是内部键 adaptive */
let paramsSpy: ReturnType<typeof vi.fn>;

async function renderDialog(onClose = vi.fn()) {
  paramsSpy = vi.fn();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BottomDialog, {
          onClose,
          onSend: vi.fn(),
          videoMediaRefs: { reference: [] },
          videoDraftBinding: { onParamsChange: paramsSpy },
        })
      ),
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

/* IKI61N：时长滑杆键盘操作——原生 range 命中画布公共 Esc 链的 INPUT 豁免会被吞键，
   Esc 在组件内自闭环（直调 onClose + 阻断冒泡），不改公共 helper 与公共 Esc 链；
   方向键步进语义与 min/max/step 原生属性一致，由原生行为承担不拦截。 */
describe('IKI61N 时长滑杆键盘操作（Esc 关闭对话框，组件内自闭环）', () => {
  async function openDurationSlider() {
    const configBtn = [...mountNode.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('16:9'),
    );
    expect(configBtn).toBeTruthy();
    await act(async () => {
      configBtn?.click();
    });
    const slider = mountNode.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider).toBeTruthy();
    return slider;
  }

  it('时长滑杆聚焦按 Esc：派发 onClose 关闭对话框并阻断冒泡（公共 Esc 链不二次处理）', async () => {
    const onClose = await renderDialog();
    const slider = await openDurationSlider();
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      slider.dispatchEvent(event);
    });
    window.removeEventListener('keydown', windowSpy);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(windowSpy).not.toHaveBeenCalled();
  });

  it('时长滑杆原生属性与模型能力一致（min/max/step 4~15 step 1，方向键由原生承担）', async () => {
    await renderDialog();
    const slider = await openDurationSlider();
    expect(slider.min).toBe('4');
    expect(slider.max).toBe('15');
    expect(slider.step).toBe('1');
    expect(slider.value).toBe('10');
  });
});

/* IKJ4W6：视频比例内部键 `adaptive`（跟随输入）界面统一显示 `auto`。
   展示名与内部名必须分离——写回 draft/提交的仍是 adaptive，否则上游火山拒单。
   默认选中由前端 pickDefaultVideoRatio 完成，不依赖后端 default_aspect_ratio。 */
describe('IKJ4W6 画布比例显示 auto', () => {
  /** 2.5 形态：支持 adaptive；后端默认仍可能是 16:9，前端应默认选中 adaptive。 */
  const adaptiveModel: GenerationModel = {
    ...seedance,
    model_id: 'seedance-2-5',
    model_label: 'Seedance 2.5',
    supported_aspect_ratios: ['16:9', '9:16', 'adaptive'],
    default_aspect_ratio: '16:9',
  };

  async function openConfig() {
    const configBtn = [...mountNode.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Seedance 2.5'),
    );
    expect(configBtn).toBeTruthy();
    await act(async () => {
      configBtn?.click();
    });
  }

  it('支持 adaptive 的模型默认选中「跟随输入」：状态栏与选项均显示 auto，不出现 adaptive', async () => {
    fetchGenerationModels.mockResolvedValue([adaptiveModel]);
    await renderDialog();
    await openConfig();

    expect(mountNode.textContent).toContain('Seedance 2.5|auto|720p|10s');
    expect(mountNode.textContent).not.toContain('adaptive');

    const option = [...mountNode.querySelectorAll(`.${styles.ratioGroup} button`)].find((button) =>
      button.textContent?.includes('auto'),
    );
    expect(option).toBeTruthy();
  });

  it('默认选中档回写草稿仍用内部键 adaptive（展示名不回写）', async () => {
    fetchGenerationModels.mockResolvedValue([adaptiveModel]);
    await renderDialog();

    expect(paramsSpy).toHaveBeenCalled();
    const patch = paramsSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(patch.ratio).toBe('adaptive');
    expect(patch.ratio).not.toBe('auto');
  });

  it('点选 auto 档：界面选中但写回草稿的仍是 adaptive', async () => {
    fetchGenerationModels.mockResolvedValue([
      { ...adaptiveModel, supported_aspect_ratios: ['16:9', 'adaptive'], default_aspect_ratio: '16:9' },
    ]);
    await renderDialog();
    await openConfig();

    const option = [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.ratioGroup} button`)].find((button) =>
      button.textContent?.includes('auto'),
    )!;
    await act(async () => {
      option.click();
    });

    const patch = paramsSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(patch.ratio).toBe('adaptive');
    expect(mountNode.textContent).toContain('Seedance 2.5|auto|');
  });
});

/* ============================================
 * IKIZQB 样片模式开关：能力位门控 / 480p 锁定与恢复 / 切模型关闭 /
 * 四模式共用 / 草稿恢复 / 报价门控与提交确认两字段。
 * 报价走全局 fetch 桩（generationQuoteOptions → apiRequest）。
 * ============================================ */

/** Seedance 2.5：样片放行能力位 + 480p 档（IKIZQ7 后端透出的 features.sample_mode）。 */
const seedance25: GenerationModel = {
  ...seedance,
  model_id: 'seedance-25',
  model_label: 'Seedance 2.5',
  supported_sizes: [
    { id: '480p', label: '480p', api_value: '480p', width: null, height: null },
    { id: '720p', label: '720p', api_value: '720p', width: null, height: null },
    { id: '1080p', label: '1080p', api_value: '1080p', width: null, height: null },
  ],
  default_size: '1080p',
  features: { ...seedance.features, sample_mode: true },
};

function quoteResponse(data: { credits: number | null; quote_revision: string | null }) {
  return new Response(JSON.stringify({ code: 200, msg: null, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface SampleDialogProps {
  projectId?: string;
  initialParams?: { modelId?: string; resolution?: string; aspectRatio?: string; sampleMode?: boolean };
  restoreExisting?: boolean;
  onSend?: ReturnType<typeof vi.fn>;
  /** IKJIVN：草稿绑定模式由父级传入当前绑定节点 id；自由模式不传（行为同旧） */
  targetNodeId?: string;
}

/** 带样片场景 props 的渲染（projectId 传入才会挂报价查询与徽标）。 */
async function renderSampleDialog(props: SampleDialogProps = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(BottomDialog, {
          onClose: vi.fn(),
          onSend: props.onSend ?? vi.fn(),
          ...(props.projectId ? { projectId: props.projectId } : {}),
          ...(props.initialParams ? { initialParams: props.initialParams } : {}),
          ...(props.targetNodeId ? { targetNodeId: props.targetNodeId } : {}),
          videoMediaRefs: { reference: [] },
          videoDraftBinding: {
            ...(props.restoreExisting ? { restoreExisting: true } : {}),
            onParamsChange: vi.fn(),
          },
        }),
      ),
    );
  });
  await act(async () => { await Promise.resolve(); });
}

/** 打开「模型与质量」配置面板（底部状态栏 SlidersHorizontal 配置按钮，含比例文案定位）。 */
async function openSampleConfig() {
  const configBtn = [...mountNode.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('16:9'),
  );
  expect(configBtn).toBeTruthy();
  await act(async () => { configBtn?.click(); });
  expect(mountNode.textContent).toContain('模型与质量');
}

function sampleSwitch(): HTMLButtonElement | null {
  return mountNode.querySelector<HTMLButtonElement>('[data-testid="sample-mode-switch"]');
}

/** 当前生效清晰度按钮（configRow 第二个 selectBtn）与文案。 */
function sizeButton(): HTMLButtonElement | undefined {
  return [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.selectBtn}`)][1];
}

/** 正文输入走 PromptRefEditor 测试接缝（jsdom 无法驱动 contentEditable）。 */
async function typePrompt(text: string) {
  await typePromptRefText(mountNode, text);
}

function sendButton(): HTMLButtonElement {
  return mountNode.querySelector<HTMLButtonElement>('[data-testid="video-send"]')!;
}

describe('BottomDialog 样片模式开关（IKIZQB）', () => {
  it('能力位未放行（features.sample_mode 缺省）→ 开关完全不渲染', async () => {
    fetchGenerationModels.mockResolvedValue([seedance, kling]);
    await renderSampleDialog();
    await openSampleConfig();
    expect(sampleSwitch()).toBeNull();
    expect(mountNode.textContent).not.toContain('样片模式');
  });

  it('放行模型默认关闭；开启锁 480p 并禁清晰度切换，关闭恢复原普通分辨率', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25, kling]);
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(quoteResponse({ credits: 60, quote_revision: 'rev-1' })));
    vi.stubGlobal('fetch', fetchMock);
    await renderSampleDialog({ projectId: 'p1' });
    await openSampleConfig();

    const sw = sampleSwitch();
    expect(sw).toBeTruthy();
    expect(sw!.getAttribute('aria-checked')).toBe('false');
    // 默认档 1080p、清晰度可选
    expect(sizeButton()!.textContent).toContain('1080p');
    expect(sizeButton()!.disabled).toBe(false);

    // 开启：锁 480p + 禁切换 + 条款说明 + 报价请求按样片规格（sample_mode + 480p）
    await act(async () => { sw!.click(); });
    expect(sampleSwitch()!.getAttribute('aria-checked')).toBe('true');
    expect(sizeButton()!.textContent).toContain('480p');
    expect(sizeButton()!.disabled).toBe(true);
    expect(mountNode.textContent).toContain('成片另行计费');
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([ , req]) =>
        (JSON.parse((req as RequestInit).body as string)).parameters?.sample_mode === true)).toBe(true));
    const sampleReq = fetchMock.mock.calls
      .map(([ , req]) => JSON.parse((req as RequestInit).body as string))
      .find((body) => body.parameters?.sample_mode === true)!;
    expect(sampleReq.parameters).toMatchObject({ sample_mode: true, resolution: '480p' });
    expect(sampleReq.type).toBe('video');

    // 关闭：恢复开启前的普通档位（1080p = 模型默认），清晰度重新可选
    await act(async () => { sampleSwitch()!.click(); });
    expect(sampleSwitch()!.getAttribute('aria-checked')).toBe('false');
    expect(sizeButton()!.textContent).toContain('1080p');
    expect(sizeButton()!.disabled).toBe(false);
    vi.unstubAllGlobals();
  });

  it('切换模型即关闭；再选回放行模型也不自动开启（父规格用户故事 3）', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25, kling]);
    await renderSampleDialog();
    await openSampleConfig();

    await act(async () => { sampleSwitch()!.click(); });
    expect(sampleSwitch()!.getAttribute('aria-checked')).toBe('true');

    // 切到未放行模型：开关消失（模型下拉第一项 Kling）
    const modelBtn = [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.selectBtn}`)][0]!;
    await act(async () => { modelBtn.click(); });
    const klingOption = [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.selectDropdown} button`)]
      .find((b) => b.textContent?.includes('Kling'))!;
    await act(async () => { klingOption.click(); });
    expect(sampleSwitch()).toBeNull();

    // 切回放行模型：开关回来但保持关闭
    await act(async () => { modelBtn.click(); });
    const backOption = [...mountNode.querySelectorAll<HTMLButtonElement>(`.${styles.selectDropdown} button`)]
      .find((b) => b.textContent?.includes('Seedance 2.5'))!;
    await act(async () => { backOption.click(); });
    expect(sampleSwitch()).toBeTruthy();
    expect(sampleSwitch()!.getAttribute('aria-checked')).toBe('false');
  });

  it('四种现有模式共用同一开关：切模式不关闭（父规格用户故事 5）', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    await renderSampleDialog();
    await openSampleConfig();
    await act(async () => { sampleSwitch()!.click(); });

    // 底部模式选择器依次切：全能参考 → 首尾帧 → 图生视频 → 文生视频
    for (const label of ['全能参考', '首尾帧', '图生视频', '文生视频']) {
      const modeBtn = [...mountNode.querySelectorAll('button')]
        .find((b) => ['文生视频', '全能参考', '首尾帧', '图生视频'].includes(b.textContent ?? ''));
      await act(async () => { modeBtn!.click(); });
      const option = [...mountNode.querySelectorAll('button')].find((b) => b.textContent === label);
      await act(async () => { option!.click(); });
      expect(sampleSwitch()?.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('草稿/样片卡恢复（initialParams.sampleMode）→ 默认开启且分辨率锁 480p', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    await renderSampleDialog({
      initialParams: { modelId: 'seedance-25', resolution: '720p', aspectRatio: '16:9', sampleMode: true },
      restoreExisting: true,
    });
    await openSampleConfig();
    expect(sampleSwitch()!.getAttribute('aria-checked')).toBe('true');
    expect(sizeButton()!.textContent).toContain('480p');
    expect(sizeButton()!.disabled).toBe(true);
  });

  it('样片无有效报价（credits null）→ 禁止提交并提示确认中（不按未知金额提交）', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(quoteResponse({ credits: null, quote_revision: null }))));
    await renderSampleDialog({ projectId: 'p1' });
    await openSampleConfig();
    await act(async () => { sampleSwitch()!.click(); });
    await typePrompt('样片内容');
    await vi.waitFor(() => expect(sendButton().disabled).toBe(true));
    expect(mountNode.textContent).toContain('样片价格确认中');
    vi.unstubAllGlobals();
  });

  it('报价就绪 → 可发送，onSend 携带 480p 与提交确认两字段（expectedCredits/quoteRevision）', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(quoteResponse({ credits: 60, quote_revision: 'rev-1' }))));
    const onSend = vi.fn();
    await renderSampleDialog({ projectId: 'p1', onSend });
    await openSampleConfig();
    await act(async () => { sampleSwitch()!.click(); });
    await typePrompt('样片内容');
    await vi.waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => { sendButton().click(); });
    expect(onSend).toHaveBeenCalledTimes(1);
    const [, opts] = onSend.mock.calls[0]! as [string, Record<string, unknown>];
    expect(opts.sampleMode).toBe(true);
    expect(opts.resolution).toBe('480p');
    expect(opts.expectedCredits).toBe(60);
    expect(opts.quoteRevision).toBe('rev-1');
    vi.unstubAllGlobals();
  });

  it('报价刷新期间（参数变化后新报价未落地）→ 禁止以旧金额提交', async () => {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(quoteResponse({ credits: 60, quote_revision: 'rev-1' })));
    vi.stubGlobal('fetch', fetchMock);
    await renderSampleDialog({ projectId: 'p1' });
    await openSampleConfig();
    await act(async () => { sampleSwitch()!.click(); });
    await typePrompt('样片内容');
    await vi.waitFor(() => expect(sendButton().disabled).toBe(false));

    // 目录/规格变化（时长变化改变定价输入）：新报价挂起未落地 → 旧金额不可再提交
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const slider = mountNode.querySelector<HTMLInputElement>('input[type="range"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(slider, '8');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(sendButton().disabled).toBe(true);
    expect(mountNode.textContent).toContain('样片价格确认中');
    vi.unstubAllGlobals();
  });
});

describe('IKJ79D 报价带提示词（防抖 600ms）', () => {
  function quoteResponse() {
    return new Response(JSON.stringify({ code: 200, msg: null, data: { credits: 42 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function renderDialogWithProject(initialText: string) {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(BottomDialog, {
            onClose: vi.fn(),
            onSend: vi.fn(),
            projectId: 'p1',
            initialText,
            videoMediaRefs: { reference: [] },
            videoDraftBinding: { onParamsChange: vi.fn() },
          }),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('初问无 prompt 键；停笔 600ms 后带 prompt 重问一次', async () => {
    const quoteFetch = vi.fn().mockResolvedValue(quoteResponse());
    vi.stubGlobal('fetch', quoteFetch);
    await renderDialogWithProject('把背景替换成海边沙滩');

    // 模型就位后首问：提示词防抖未到，不带 prompt 键
    await vi.waitFor(() => expect(quoteFetch).toHaveBeenCalledTimes(1));
    const firstBody = JSON.parse((quoteFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(firstBody.parameters).not.toHaveProperty('prompt');
    expect(String(quoteFetch.mock.calls[0]![0])).toBe('/api/projects/p1/generation-jobs/quote');

    // 停笔 600ms：带提示词重问（编辑单判定输入）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 750));
    });
    await vi.waitFor(() => expect(quoteFetch).toHaveBeenCalledTimes(2));
    const secondBody = JSON.parse((quoteFetch.mock.calls[1]![1] as RequestInit).body as string);
    expect(secondBody.parameters.prompt).toBe('把背景替换成海边沙滩');

    // 防抖收敛：不再继续问价
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(quoteFetch).toHaveBeenCalledTimes(2);
  });

  it('空提示词面板：报价请求恒不带 prompt 键', async () => {
    const quoteFetch = vi.fn().mockResolvedValue(quoteResponse());
    vi.stubGlobal('fetch', quoteFetch);
    await renderDialogWithProject('');

    await vi.waitFor(() => expect(quoteFetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 750));
    });
    const bodies = quoteFetch.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string).parameters,
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('prompt');
  });
});

/* ============================================
 * IKJIVN：样片报价查询 payload 携带 target_node_id（PR !968 / IKJGE6 契约面）。
 * 提交侧草稿绑定模式按 target_node_id 做画布文本带入合并（服务端复算 quote_stale 的
 * 判定输入），报价与提交不同源就会被误拒——样片报价查询必须与提交同源带上该键；
 * 自由模式（无绑定节点）不带，行为同旧。
 * ============================================ */
describe('IKJIVN 样片报价 payload 携带 target_node_id', () => {
  function quoteResponseReady() {
    return new Response(
      JSON.stringify({ code: 200, msg: null, data: { credits: 60, quote_revision: 'rev-1' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /** 开启样片并等样片规格报价请求落地，返回全部报价请求体（props 透传 renderSampleDialog）。 */
  async function openSampleAndCollectQuoteBodies(
    fetchMock: ReturnType<typeof vi.fn>,
    props: SampleDialogProps = {},
  ) {
    fetchGenerationModels.mockResolvedValue([seedance25]);
    await renderSampleDialog({ projectId: 'p1', ...props });
    await openSampleConfig();
    await act(async () => { sampleSwitch()!.click(); });
    // 先确保样片规格请求真的发出（负向断言的前提：请求存在才谈得上「不带某键」）
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([, req]) =>
        (JSON.parse((req as RequestInit).body as string)).parameters?.sample_mode === true)).toBe(true));
    return fetchMock.mock.calls.map(([, req]) => JSON.parse((req as RequestInit).body as string));
  }

  it('草稿绑定模式：样片报价查询 payload 的 target_node_id = 当前绑定节点 id（与提交同源）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponseReady());
    vi.stubGlobal('fetch', fetchMock);

    // 草稿绑定模式：父级传入当前绑定节点 id（经 helper 透传 renderSampleDialog）
    const bodies = await openSampleAndCollectQuoteBodies(fetchMock, { targetNodeId: 'media-draft-9' });
    // 样片报价查询（提交门控的唯一金额来源）必须带同一目标。正常路径徽标与样片查询共用
    // 同一 queryKey 只发一次；若两出口任一漏带 target_node_id，键分叉会发出多份样片规格
    // 请求且漏带的那份在此现形——所以断言「每一份」而不是「找到一份」。
    const sampleBodies = bodies.filter((body) => body.parameters?.sample_mode === true);
    expect(sampleBodies.length).toBeGreaterThanOrEqual(1);
    for (const body of sampleBodies) {
      expect(body.target_node_id).toBe('media-draft-9');
    }
    // 报价徽标（预览价）与样片查询共用提交同源口径，同样带目标节点
    const previewBody = bodies.find((body) => body.parameters?.sample_mode !== true)!;
    expect(previewBody.target_node_id).toBe('media-draft-9');
    vi.unstubAllGlobals();
  });

  it('自由模式（无绑定节点）：报价请求不携带 target_node_id（行为同旧）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponseReady());
    vi.stubGlobal('fetch', fetchMock);

    const bodies = await openSampleAndCollectQuoteBodies(fetchMock);
    for (const body of bodies) {
      expect(body).not.toHaveProperty('target_node_id');
    }
    vi.unstubAllGlobals();
  });
});
