// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageEnhanceDialog from './index';
import styles from './index.module.css';
import { freezeImageEnhanceParams, imageEnhanceTierGateReason, pickImageEnhanceTier } from '../../imageEnhance';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let sendMock: ReturnType<typeof vi.fn>;

function renderPanel(props: Partial<Parameters<typeof ImageEnhanceDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(ImageEnhanceDialog, {
        onClose: () => {},
        onSend: sendMock,
        ...props,
      } as Parameters<typeof ImageEnhanceDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function openModelMenu() {
  await click(btn('enhance-model-btn'));
}

beforeEach(() => {
  sendMock = vi.fn(() => true);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe('IKGM9O 面板选项渲染与默认值', () => {
  it('默认值：供应商 MediaKit、模型 Pro、倍数 2、增强策略生成度优先、色彩校正默认开', () => {
    renderPanel();
    expect(btn('enhance-provider-btn').textContent).toContain('MediaKit');
    expect(btn('enhance-model-btn').textContent).toContain('Pro');
    expect(btn('enhance-multiple-2').className).toMatch(/multipleBtnActive/);
    expect(btn('enhance-mode-generative_first').className).toMatch(/multipleBtnActive/);
    expect(btn('enhance-mode-fidelity_first').className).not.toMatch(/multipleBtnActive/);
    expect((container!.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement).checked).toBe(false);
  });

  it('两级下拉：模型级提供 Lite / Pro / Max 三档，供应商级仅 MediaKit 一项', async () => {
    renderPanel();
    await openModelMenu();
    for (const tier of ['lite', 'pro', 'max']) {
      expect(btn(`enhance-model-option-${tier}`)).toBeTruthy();
    }
    await click(btn('enhance-provider-btn'));
    const providerOptions = [...container!.querySelectorAll(`.${styles.selectOption}`)] as HTMLButtonElement[];
    expect(providerOptions.length).toBe(1);
    expect(providerOptions[0]!.textContent).toBe('MediaKit');
  });

  it('放大倍数可切换 2/4/6 分段按钮', async () => {
    renderPanel();
    await click(btn('enhance-multiple-6'));
    expect(btn('enhance-multiple-6').className).toMatch(/multipleBtnActive/);
    await click(btn('enhance-multiple-4'));
    expect(btn('enhance-multiple-4').className).toMatch(/multipleBtnActive/);
  });

  it('回填 lastParams：初始参数恢复上次的档/倍数/策略/开关', () => {
    renderPanel({
      initialParams: { version_tier: 'max', multiple: 4, generative_enhance_mode: 'fidelity_first', enable_correct_color: false },
    });
    expect(btn('enhance-model-btn').textContent).toContain('Max');
    expect(btn('enhance-multiple-4').className).toMatch(/multipleBtnActive/);
    expect(btn('enhance-mode-fidelity_first').className).toMatch(/multipleBtnActive/);
    expect((container!.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement).checked).toBe(false);
  });
});

describe('IKGM9O 置灰与悬停原因', () => {
  it('选 Lite：增强策略置灰并悬停说明不支持；展示冻结值生成度优先', async () => {
    renderPanel();
    await openModelMenu();
    await click(btn('enhance-model-option-lite'));
    const modeBtn = btn('enhance-mode-generative_first');
    expect(modeBtn.getAttribute('aria-disabled')).toBe('true');
    expect(modeBtn.getAttribute('title')).toBe('Lite 版本不支持增强策略');
    expect(modeBtn.className).toMatch(/multipleBtnActive/);
    expect(btn('enhance-mode-fidelity_first').className).not.toMatch(/multipleBtnActive/);
  });

  it('非 Max 档：色彩校正置灰并悬停说明仅 Max 支持；展示关闭态', async () => {
    renderPanel();
    const row = container!.querySelector('[data-testid="enhance-color-row"]')!;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.getAttribute('title')).toBe('仅 Max 版本支持色彩校正');
    expect((container!.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement).checked).toBe(false);
    await openModelMenu();
    await click(btn('enhance-model-option-max'));
    const rowMax = container!.querySelector('[data-testid="enhance-color-row"]')!;
    expect(rowMax.getAttribute('aria-disabled')).toBeNull();
    expect((container!.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement).checked).toBe(true);
  });
});

describe('IKGM9O 尺寸预检各档边界', () => {
  it('门槛函数边界：各档恰好在门槛上可用、越界不可用（与后端 TIER_SIZE_LIMITS 同源口径）', () => {
    expect(imageEnhanceTierGateReason('lite', 2160, 16)).toBeNull();
    expect(imageEnhanceTierGateReason('lite', 2161, 100)).toContain('Lite');
    expect(imageEnhanceTierGateReason('lite', 1000, 15)).toContain('Lite');
    expect(imageEnhanceTierGateReason('pro', 2048, 256)).toBeNull();
    expect(imageEnhanceTierGateReason('pro', 2049, 300)).toContain('Pro');
    expect(imageEnhanceTierGateReason('pro', 1000, 255)).toContain('Pro');
    expect(imageEnhanceTierGateReason('max', 6240, 195)).toBeNull();
    expect(imageEnhanceTierGateReason('max', 6241, 200)).toContain('Max');
    expect(imageEnhanceTierGateReason('max', 3000, 63)).toContain('Max');
    expect(imageEnhanceTierGateReason('max', 2065, 64)).toContain('Max');
    expect(imageEnhanceTierGateReason('lite', undefined, undefined)).toBeNull();
    expect(imageEnhanceTierGateReason('pro', undefined, 100)).toBeNull();
  });

  it('不满足门槛的档在下拉置灰并悬停原因；点置灰档不切换', async () => {
    renderPanel({ sourceDims: { width: 1024, height: 100 } });
    await openModelMenu();
    const pro = btn('enhance-model-option-pro');
    expect(pro.getAttribute('aria-disabled')).toBe('true');
    expect(pro.getAttribute('title')).toContain('Pro 版本门槛');
    await click(pro);
    expect(btn('enhance-model-btn').textContent).toContain('Lite');
  });

  it('默认档（Pro）不可用时自动落到第一个可用档', () => {
    renderPanel({ sourceDims: { width: 1200, height: 200 } });
    expect(btn('enhance-model-btn').textContent).toContain('Lite');
    renderPanel({ sourceDims: { width: 3000, height: 900 } });
    expect(btn('enhance-model-btn').textContent).toContain('Max');
  });

  it('三档全不可用：禁用发送并说明原因', () => {
    renderPanel({ sourceDims: { width: 8000, height: 100 } });
    const send = btn('enhance-send-btn');
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('title')).toContain('不满足任何版本档门槛');
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain('不满足任何版本档门槛');
    expect(pickImageEnhanceTier('pro', 8000, 100)).toBeNull();
  });

  it('无尺寸数据：三档全可用、默认 Pro 可发送', () => {
    renderPanel({ sourceDims: null });
    expect(btn('enhance-model-btn').textContent).toContain('Pro');
    expect(btn('enhance-send-btn').disabled).toBe(false);
  });
});

describe('IKGM9O 提交 payload 冻结口径', () => {
  it('freezeImageEnhanceParams：非 Max 冻结 enable_correct_color=false；Lite 冻结 generative_first', () => {
    const picked = { version_tier: 'max', multiple: 4, generative_enhance_mode: 'fidelity_first', enable_correct_color: true } as const;
    expect(freezeImageEnhanceParams(picked)).toEqual(picked);
    expect(
      freezeImageEnhanceParams({ ...picked, version_tier: 'pro' }),
    ).toEqual({ ...picked, version_tier: 'pro', enable_correct_color: false });
    expect(
      freezeImageEnhanceParams({ ...picked, version_tier: 'lite', generative_enhance_mode: 'fidelity_first' }),
    ).toEqual({ ...picked, version_tier: 'lite', generative_enhance_mode: 'generative_first', enable_correct_color: false });
  });

  it('面板发送交付冻结后的参数（Pro 档色彩校正提交 false，即使面板默认开）', async () => {
    renderPanel();
    await click(btn('enhance-send-btn'));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      version_tier: 'pro',
      multiple: 2,
      generative_enhance_mode: 'generative_first',
      enable_correct_color: false,
    });
  });

  it('Max 档尊重用户开关：关掉后提交 enable_correct_color=false；开则 true', async () => {
    renderPanel();
    await openModelMenu();
    await click(btn('enhance-model-option-max'));
    const toggle = container!.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await click(btn('enhance-send-btn'));
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ version_tier: 'max', enable_correct_color: false }),
    );
    const toggle2 = container!.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement;
    await act(async () => {
      toggle2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await click(btn('enhance-send-btn'));
    expect(sendMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ version_tier: 'max', enable_correct_color: true }),
    );
  });

  it('onSend 返回 false（未发出）可再次点击发送', async () => {
    sendMock = vi.fn(() => false);
    renderPanel();
    await click(btn('enhance-send-btn'));
    await click(btn('enhance-send-btn'));
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe('IKGM9O 发送后关闭与生成中只读', () => {
  it('发送成功（onSend 返回 true）后父级卸载面板（发送后自动关闭）', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(ImageEnhanceDialog, {
          onClose: () => {},
          onSend: () => true,
          sourceDims: null,
        }),
      );
    });
    expect(container.querySelector('[data-testid="enhance-send-btn"]')).toBeTruthy();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="enhance-send-btn"]')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    act(() => {
      root!.render(createElement('div'));
    });
    expect(container.querySelector('[data-testid="enhance-send-btn"]')).toBeNull();
  });

  it('生成中：参数只读冻结（下拉/倍数/开关全部禁用，只读提示可见）', async () => {
    renderPanel({ generating: true, initialParams: { version_tier: 'max', multiple: 4, generative_enhance_mode: 'generative_first', enable_correct_color: true } });
    expect(container!.textContent).toContain('生成中，参数只读');
    expect(btn('enhance-provider-btn').disabled).toBe(true);
    expect(btn('enhance-model-btn').disabled).toBe(true);
    expect(btn('enhance-multiple-2').disabled).toBe(true);
    expect(btn('enhance-mode-generative_first').getAttribute('aria-disabled')).toBe('true');
    expect(container!.querySelector('[data-testid="enhance-color-row"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(btn('enhance-send-btn').disabled).toBe(true);
  });
});
