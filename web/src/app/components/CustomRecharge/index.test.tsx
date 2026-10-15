// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomRecharge from './index';


const rechargeApi = vi.hoisted(() => ({ fetchRechargeCustomConfig: vi.fn() }));

vi.mock('@/app/api/recharge', () => rechargeApi);

const CONFIG = {
  enabled: true,
  min_credits: 600,
  max_credits: 499_995,
  default_credits: 600,
  step_credits: 15,
  credits_per_yuan: 15,
  credits_valid_months: 24,
  can_purchase: null as boolean | null,
  denied_hint: '当前账号暂不可购买自定义充值',
};

let root: Root;
let mountNode: HTMLDivElement;
let onConfirm: ReturnType<typeof vi.fn>;
let onRequireLogin: ReturnType<typeof vi.fn>;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(overrides: Record<string, unknown> = {}) {
  rechargeApi.fetchRechargeCustomConfig.mockResolvedValue({ ...CONFIG, ...overrides });
  await act(async () => {
    root.render(
      createElement(CustomRecharge, { onConfirm, onRequireLogin, ...overrides.__props as object }),
    );
  });
  await flush();
}

function numberInput(): HTMLInputElement {
  return mountNode.querySelector('input[aria-label="手动输入积分数量"]') as HTMLInputElement;
}

function slider(): HTMLInputElement {
  return mountNode.querySelector('input[type="range"]') as HTMLInputElement;
}

function buyButton(): HTMLButtonElement {
  return mountNode.querySelector('button') as HTMLButtonElement;
}

function type(value: string): void {
  const el = numberInput();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function blur(): Promise<void> {
  await act(async () => {
    numberInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  rechargeApi.fetchRechargeCustomConfig.mockReset();
  onConfirm = vi.fn();
  onRequireLogin = vi.fn();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

describe('CustomRecharge — 展示（PRD §7.2 / §7.6「默认值」）', () => {
  it('★ 进入时默认展示 600 积分与 ¥40', async () => {
    await render();

    expect(numberInput().value).toBe('600');
    expect(slider().value).toBe('600');
    expect(mountNode.textContent).toContain('¥40');
  });

  it('★ 展示最低/最高积分与范围提示', async () => {
    await render();

    expect(mountNode.textContent).toContain('600');
    expect(mountNode.textContent).toContain('499,995');
  });

  it('★ 后台关闭自定义充值（enabled=false）→ 整块不展示', async () => {
    await render({ enabled: false });

    expect(mountNode.textContent).toBe('');
  });

  it('配置拉不到 → 不渲染（拿编的上下限去渲染会引导用户按不存在的规则下单）', async () => {
    rechargeApi.fetchRechargeCustomConfig.mockRejectedValue(new Error('boom'));
    await act(async () => {
      root.render(createElement(CustomRecharge, { onConfirm }));
    });
    await flush();

    expect(mountNode.textContent).toBe('');
  });
});

describe('CustomRecharge — 输入与计算（PRD §7.3）', () => {
  it('★ 拖滑杆实时刷新价格（1 元 = 15 积分）', async () => {
    await render();

    await act(async () => {
      const el = slider();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, '1500');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(mountNode.textContent).toContain('¥100');
  });

  it('★ 手动输入合法值：失焦后生效，价格跟着变', async () => {
    await render();

    type('1200');
    await blur();

    expect(numberInput().value).toBe('1200');
    expect(mountNode.textContent).toContain('¥80');
  });

  it('★ 低于最低 → 自动修正为最低并说明改成了什么（不是无声修改）', async () => {
    await render();

    type('100');
    await blur();

    expect(numberInput().value).toBe('600');
    expect(mountNode.textContent).toContain('已修正为 600 积分');
  });

  it('★ 高于最高 → 压到最高', async () => {
    await render();

    type('999999');
    await blur();

    expect(numberInput().value).toBe('499,995'.replace(',', ''));
    expect(mountNode.textContent).toContain('已修正为 499,995 积分');
  });

  it('★ 不在步长格点上 → 吸附到最近的格点（按后台配的步长修正）', async () => {
    await render();

    type('4996');
    await blur();

    expect(numberInput().value).toBe('4995');
    expect(mountNode.textContent).toContain('已修正为 4,995 积分');
  });

  it('输入框清空 → 回落到后台配的默认值', async () => {
    await render();

    type('');
    await blur();

    expect(numberInput().value).toBe('600');
  });

  it('合法值不弹修正提示（别对没改的东西说「已修正」）', async () => {
    await render();

    type('900');
    await blur();

    expect(mountNode.textContent).not.toContain('已修正');
  });
});

describe('CustomRecharge — 购买（PRD §7.5 / §7.6）', () => {
  it('★ 游客：可见但不可买 —— 按钮是「登录后购买」，点击只引导登录，**不建单**', async () => {
    await render({ can_purchase: null });

    expect(mountNode.textContent).toContain('¥40');
    expect(buyButton().textContent).toContain('登录后购买');

    await click(buyButton());

    expect(onRequireLogin).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('★ 登录且有权限：点购买把**修正后**的积分数交出去', async () => {
    await render({ can_purchase: true });

    expect(buyButton().textContent).toContain('¥40 购买');
    await click(buyButton());

    expect(onConfirm).toHaveBeenCalledWith(600);
  });

  it('★ 没失焦就直接点购买：交出去的仍是修正后的合法值（服务端对非格点值是拒绝的）', async () => {
    await render({ can_purchase: true });

    type('601');
    await click(buyButton());

    expect(onConfirm).toHaveBeenCalledWith(600);
  });

  it('★ 无权限：展示后台配的提示，按钮禁用，**不建单**', async () => {
    await render({ can_purchase: false, denied_hint: '该活动仅限内测用户' });

    expect(mountNode.textContent).toContain('该活动仅限内测用户');
    expect(buyButton().disabled).toBe(true);

    await click(buyButton());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onRequireLogin).not.toHaveBeenCalled();
  });

  it('下单中：按钮显示「下单中…」且重复点击不再建单（PRD §7.5 防重复提交）', async () => {
    rechargeApi.fetchRechargeCustomConfig.mockResolvedValue({ ...CONFIG, can_purchase: true });
    await act(async () => {
      root.render(
        createElement(CustomRecharge, { onConfirm, submitting: true }),
      );
    });
    await flush();

    expect(buyButton().textContent).toContain('下单中…');
    expect(buyButton().disabled).toBe(true);

    await click(buyButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('下单失败：错误就地展示在面板里（调用方给文案）', async () => {
    rechargeApi.fetchRechargeCustomConfig.mockResolvedValue({ ...CONFIG, can_purchase: true });
    await act(async () => {
      root.render(
        createElement(CustomRecharge, { onConfirm, error: '该活动仅限内测用户' }),
      );
    });
    await flush();

    expect(mountNode.textContent).toContain('该活动仅限内测用户');
  });

  it('★ 面板里**没有**首购相关文案（首购未定形，刻意停放）', async () => {
    await render({ can_purchase: true });

    expect(mountNode.textContent).not.toContain('首购');
  });
});
