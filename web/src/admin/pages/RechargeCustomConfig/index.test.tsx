// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import RechargeCustomConfig from './index';


const api = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('@/api/adminRechargeCustomConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminRechargeCustomConfig')>();
  return {
    ...actual,
    saveAdminRechargeCustomConfig: api.saveConfig,
    adminRechargeCustomConfigOptions: () => ({
      queryKey: actual.adminRechargeCustomConfigKeys.all,
      queryFn: api.fetchConfig,
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CONFIG = {
  minCredits: 600,
  maxCredits: 499_995,
  defaultCredits: 600,
  creditsPerYuan: 15,
  stepCredits: 15,
  enabled: true,
  permission: 'all' as const,
  permissionAllowlist: [] as string[],
  permissionDeniedHint: '',
  creditsValidMonths: 24,
  version: 3,
  updatedAt: '2026-09-27T10:00:00+08:00',
  permissionLabel: '全部登录用户',
};

let root: Root;
let mountNode: HTMLDivElement;

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, node);
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(RechargeCustomConfig)));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`没有找到按钮：${label}（页面上有：${document.body.textContent}）`);
  return found;
}

function inputByLabel(label: string): HTMLInputElement {
  const found = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`没有找到输入框：${label}`);
  return found;
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

async function type(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

async function choose(label: string, optionIncludes: string) {
  const trigger = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!trigger) throw new Error(`没有找到下拉框：${label}`);
  await click(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
    o.textContent?.includes(optionIncludes),
  );
  if (!option) throw new Error(`没有找到选项：${optionIncludes}`);
  await click(option);
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchConfig.mockResolvedValue(CONFIG);
  api.saveConfig.mockResolvedValue({ data: { ...CONFIG, version: 4 }, warning: undefined });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('自定义充值配置页', () => {
  it('字段取自接口，并在页头旁给出「当前生效」', async () => {
    await renderPage();

    expect(inputByLabel('最低积分').value).toBe('600');
    expect(inputByLabel('最高积分').value).toBe('499995');
    expect(inputByLabel('默认积分').value).toBe('600');
    expect(inputByLabel('每元积分数').value).toBe('15');
    expect(inputByLabel('积分步长').value).toBe('15');
    expect(inputByLabel('积分有效期（月）').value).toBe('24');

    expect(document.body.textContent).toContain('已启用（用户侧展示）');
    expect(document.body.textContent).toContain('配置版本 v3');
    expect(document.body.textContent).toContain('全部登录用户');
  });

  it('★ 把「每元积分数」与消费锚点的区别写在字段旁边（运营最容易搞混的那件事）', async () => {
    await renderPage();

    expect(document.body.textContent).toContain(
      '与消费锚点「1 元 = 15 积分」（生成任务计价）不是一个数',
    );
    expect(document.body.textContent).toContain('改它不会改生成任务的价格');
  });

  it('★ 草稿摘要实时算出价格：600 积分 = ¥40', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('默认：600 积分 = ¥40');
    expect(document.body.textContent).toContain('范围：600 – 499,995 积分');
  });

  it('★ 保存发整份（camelCase），成功提示带服务端回的版本号', async () => {
    await renderPage();
    await type(inputByLabel('默认积分'), '1500');
    await click(button('保存'));

    expect(api.saveConfig).toHaveBeenCalledWith({
      minCredits: 600,
      maxCredits: 499_995,
      defaultCredits: 1500,
      creditsPerYuan: 15,
      stepCredits: 15,
      creditsValidMonths: 24,
      enabled: true,
      permission: 'all',
      permissionAllowlist: [],
      permissionDeniedHint: '',
    });
    expect(document.body.textContent).toContain('已保存，配置版本 v4');
  });

  it('★ 非法值在本地先拦下：不发请求，就地显示与服务端同一句文案', async () => {
    await renderPage();
    await type(inputByLabel('每元积分数'), '7');
    await click(button('保存'));

    expect(api.saveConfig).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('不能被每元积分数 7 整除');
  });

  it('保存失败把后端文案就地展示（不弹 toast 说两遍）', async () => {
    api.saveConfig.mockRejectedValue(new ApiError(400, '保存失败：配置版本冲突'));
    await renderPage();
    await click(button('保存'));

    expect(document.body.textContent).toContain('保存失败：配置版本冲突');
  });

  it('★ 购买权限选「指定用户群」才出现白名单输入', async () => {
    await renderPage();
    expect(document.body.querySelector('input[aria-label="添加白名单用户"]')).toBeNull();

    await choose('购买权限', '指定用户群');

    expect(document.body.querySelector('input[aria-label="添加白名单用户"]')).not.toBeNull();
  });

  it('停用态在页头如实标出（关闭后用户侧不展示）', async () => {
    api.fetchConfig.mockResolvedValue({ ...CONFIG, enabled: false });
    await renderPage();

    expect(document.body.textContent).toContain('已停用（用户侧不展示）');
  });
});
