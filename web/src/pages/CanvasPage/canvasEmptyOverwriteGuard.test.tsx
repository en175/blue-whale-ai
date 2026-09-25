// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

/* IKIIWN 画布空覆盖防护页面级链路：自动保存只在「本会话成功水合（非 loadFailed）」后发起；
   空保存的 confirmEmpty 只授予水合基线非空的会话（用户显式删光场景）。
   服务端 422 兜底（水合进来即为空的空提交不带标记被拒）由 canvas.service / canvas.test 覆盖。 */

function seedDoc(nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>, loadFailed = false) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges: [],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
    loadFailed,
  };
}

const T1 = { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '雨夜', text: '霓虹' } };

async function deleteNodes(ids: string[]) {
  await act(async () => {
    flowProps.current.onDeleteNode(ids);
  });
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
});

describe('IKIIWN 画布空覆盖防护', () => {
  it('水合基线非空 → 用户删光 → 自动保存空文档且携带 confirmEmpty=true', async () => {
    seedDoc([T1]);
    await renderPage();

    await deleteNodes(['t1']);

    await vi.waitFor(() => {
      const call = apiMocks.saveCanvasDoc.mock.calls.at(-1)!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBe(true);
    }, { timeout: 3000 });
  });

  it('加载失败（loadFailed）→ 即便画布有节点可删也不发起自动保存——初始空状态无权覆盖服务端事实', async () => {
    seedDoc([T1], true);
    await renderPage();

    await deleteNodes(['t1']);

    // 防抖 800ms，等满 1.1s 确认守卫生效（真实计时器）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });
});
