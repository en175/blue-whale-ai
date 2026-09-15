// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRecord } from '@/api/assets';
import { usePreviewAsset } from './previewAsset';

/* IKFTQW：详情弹窗的资产来源——详情优先、列表兜底。
   「点开即出图 / 切资产不串 / 失败不空窗」三条交互规则都落在这个 hook 上，
   所以按真实 fetch 打桩跑完整链路，不绕开 http 层、也不断言内部状态。

   ⚠️ 每个用例必须用**互不相同**的素材 id：http 层有一张模块级「GET 在途去重」表
   （http.ts 的 `inflight`），按路径去重、请求结束才释放。本文件的取数桩是刻意
   永不 resolve 的（要观察「还在途」那一瞬），同路径的第二次调用会被去重吞掉、
   根本不调 fetch。 */

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

let root: Root;
let mountNode: HTMLDivElement;
let queryClient: QueryClient;
/** 挂起的请求：URL → resolve。让测试能在「详情还没回来」那一刻观察渲染结果。 */
let pending: Map<string, (res: Response) => void>;

function assetRecord(id: string, model = 'Seedream 5.0 Lite'): AssetRecord {
  return {
    id,
    type: 'image',
    url: 'https://tos.test/a.png',
    width: 1024,
    height: 1024,
    duration: null,
    size: 2048,
    source: 'generated',
    model,
    created_at: '2026-09-15T00:00:00.000Z',
  };
}

function detailResponse(asset: AssetRecord, code = 200, status = 200) {
  return new Response(
    JSON.stringify({
      code,
      msg: code === 200 ? 'ok' : '资产服务暂不可用',
      data: code === 200 ? asset : null,
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

async function resolveRequest(url: string, res: Response) {
  const resolve = pending.get(url);
  if (!resolve) throw new Error(`没有挂起的请求：${url}；当前挂起：${[...pending.keys()].join(', ') || '(空)'}`);
  await act(async () => {
    resolve(res);
    // 响应体是流，`.json()` 解出 envelope 再 setState 要走好几拍——空转几拍让结果落进 DOM。
    for (let i = 0; i < 5; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

/** 等条件成立，最多空转若干拍。
 *
 *  Query 是在 effect 里发请求的，具体在哪一拍发出由 React 调度决定——固定等
 *  `setTimeout(0)` 一拍会随机踩空（本文件第一版就是这么挂的）。这里显式等到
 *  「请求确实发出去了」再断言，不赌时序。 */
async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`等待超时：${label}`);
}

function Probe({ target }: { target: AssetRecord | null }) {
  const asset = usePreviewAsset(target);
  return createElement('span', { 'data-testid': 'asset' }, JSON.stringify(asset ?? null));
}

/** 渲染并（默认）等到详情请求发出；`expectedUrl` 为该次渲染应发出的请求。 */
async function renderProbe(target: AssetRecord | null, expectedUrl?: string) {
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Probe, { target })),
    );
  });
  if (expectedUrl) await waitFor(() => pending.has(expectedUrl), `发出 ${expectedUrl}`);
}

/** 当前渲染出来的资产（列表记录没有 prompt 字段，JSON 里就没有这个键）。 */
function rendered(): AssetRecord | null {
  return JSON.parse(document.body.querySelector('[data-testid="asset"]')?.textContent ?? 'null');
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  pending = new Map();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          pending.set(String(url), resolve);
        }),
    ),
  );
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.unstubAllGlobals();
});

describe('usePreviewAsset（IKFTQW）', () => {
  it('详情还在途时先用列表记录渲染——点开不白屏', async () => {
    await renderProbe(assetRecord('7001'), '/api/assets/7001');

    expect(rendered()).toMatchObject({ id: '7001', model: 'Seedream 5.0 Lite' });
  });

  it('详情回来后补上提示词，其余字段不丢', async () => {
    const url = '/api/assets/7002';
    await renderProbe(assetRecord('7002'), url);

    await resolveRequest(url, detailResponse({ ...assetRecord('7002'), prompt: '一只白鲸穿过蓝色鲸落' }));

    expect(rendered()).toMatchObject({
      id: '7002',
      model: 'Seedream 5.0 Lite',
      url: 'https://tos.test/a.png',
      prompt: '一只白鲸穿过蓝色鲸落',
    });
  });

  it('详情请求失败时保留列表记录，不空窗、不报错', async () => {
    const url = '/api/assets/7003';
    await renderProbe(assetRecord('7003'), url);

    await resolveRequest(url, detailResponse(assetRecord('7003'), 500, 500));

    expect(rendered()).toMatchObject({ id: '7003', model: 'Seedream 5.0 Lite' });
    expect(rendered()).not.toHaveProperty('prompt');
  });

  it('弹窗关闭（target 为 null）时不发请求', async () => {
    await renderProbe(null);

    expect(rendered()).toBeNull();
    expect(pending.size).toBe(0);
  });

  it('快速切换资产时，上一张迟到的响应不会串进当前弹窗', async () => {
    const staleUrl = '/api/assets/7004';
    await renderProbe(assetRecord('7004'), staleUrl);
    // 切到 7005：这一张的请求发出去，而 7004 那笔还挂在途中。
    await renderProbe(assetRecord('7005', 'Seedance 2.0'), '/api/assets/7005');

    await resolveRequest(staleUrl, detailResponse({ ...assetRecord('7004'), prompt: '上一张的提示词' }));

    expect(rendered()).toMatchObject({ id: '7005', model: 'Seedance 2.0' });
    expect(rendered()).not.toHaveProperty('prompt');
  });
});
