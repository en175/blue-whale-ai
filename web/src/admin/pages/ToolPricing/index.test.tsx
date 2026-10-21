// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import ToolPricing from './index';

const api = vi.hoisted(() => ({
  fetchMediaToolPricing: vi.fn(),
  updateMediaToolPricing: vi.fn(),
}));

vi.mock('@/admin/api/adminMediaToolPricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/admin/api/adminMediaToolPricing')>();
  return {
    ...actual,
    fetchMediaToolPricing: api.fetchMediaToolPricing,
    updateMediaToolPricing: api.updateMediaToolPricing,
    mediaToolPricingOptions: () => ({
      queryKey: actual.mediaToolPricingKeys.list(),
      queryFn: api.fetchMediaToolPricing,
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mountNode: HTMLDivElement;

const ROW = {
  id: '1',
  tool_type: 'audio_trim',
  label: '音频截取',
  pricing: {
    baseUnit: 'usage.seconds',
    basePrice: { kind: 'const', value: 1000 },
    unitDenominator: 60,
    quantityStep: 60,
    minCredits: 1,
  },
  version: 3,
  enabled: true,
  charge_enabled: true,
  created_at: '2026-10-19T10:00:00+08:00',
  updated_at: '2026-10-19T10:00:00+08:00',
};

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

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(ToolPricing)));
  });
  await settle();
}

function buttonByAria(label: string): HTMLButtonElement {
  const found = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`没有找到按钮：${label}`);
  return found;
}

async function typeInto(el: HTMLTextAreaElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchMediaToolPricing.mockResolvedValue([ROW]);
  api.updateMediaToolPricing.mockResolvedValue({ ...ROW, version: 4 });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('工具计费页', () => {
  it('列出工具、计价摘要与版本', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('音频截取');
    expect(document.body.textContent).toContain('1 积分 / 分钟（按 60 秒向上取整，最低 1 积分）');
    expect(document.body.textContent).toContain('v3');
    expect(document.body.textContent).toContain('计费');
  });

  it('非法 JSON 不发起保存并提示原因', async () => {
    await renderPage();
    await click(buttonByAria('编辑 音频截取 的计价'));
    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();
    await typeInto(textarea!, '{oops}');
    const saveButton = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '保存',
    )!;
    await click(saveButton);

    expect(api.updateMediaToolPricing).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('计价规则不是合法 JSON');
  });

  it('保存合法 JSON 时提交完整规则并回显成功', async () => {
    await renderPage();
    await click(buttonByAria('编辑 音频截取 的计价'));
    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!;
    await typeInto(textarea, '{"baseUnit":"constant:1","basePrice":{"kind":"const","value":1000}}');
    const saveButton = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '保存',
    )!;
    await click(saveButton);

    expect(api.updateMediaToolPricing).toHaveBeenCalledWith('audio_trim', {
      label: '音频截取',
      enabled: true,
      charge_enabled: true,
      pricing: { baseUnit: 'constant:1', basePrice: { kind: 'const', value: 1000 } },
    });
    expect(document.body.textContent).toContain('已保存「音频截取」');
  });

  it('保存成功后回读列表并展示新版本', async () => {
    api.fetchMediaToolPricing
      .mockResolvedValueOnce([ROW])
      .mockResolvedValueOnce([{ ...ROW, version: 4 }]);
    await renderPage();
    await click(buttonByAria('编辑 音频截取 的计价'));
    const saveButton = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '保存',
    )!;
    await click(saveButton);

    expect(api.fetchMediaToolPricing).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('v4');
  });

  it('服务端校验失败时在弹窗内展示原文并保留编辑', async () => {
    api.updateMediaToolPricing.mockRejectedValue(
      new ApiError(400, 'pricing.basePrice 格式非法'),
    );
    await renderPage();
    await click(buttonByAria('编辑 音频截取 的计价'));
    const saveButton = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '保存',
    )!;
    await click(saveButton);

    expect(document.body.textContent).toContain('pricing.basePrice 格式非法');
    expect(document.body.querySelector('textarea')).not.toBeNull();
  });
});
