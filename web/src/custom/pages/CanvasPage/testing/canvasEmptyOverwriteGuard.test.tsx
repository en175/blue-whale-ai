// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  locationRef,
  navigateRef,
  renderPage,
  unmountPage,
} from './canvasPageTestHarness';

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ records: [], next_cursor: null, protocol_version: 1, canvas_version: null }),
  })),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
}));


async function addTextNodeViaPaneMenu() {
  await act(async () => {
    flowProps.current.onPaneContextMenu({ clientX: 10, clientY: 10 });
  });
  const addItem = [...document.querySelectorAll('button')].find((b) => b.textContent === '添加节点');
  expect(addItem).toBeTruthy();
  await act(async () => {
    addItem!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  });
  const textItem = [...document.querySelectorAll('button')].find((b) => b.textContent === '文本');
  expect(textItem).toBeTruthy();
  await act(async () => {
    textItem!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

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

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });
});

const CONFLICT_TOAST = '画布已被其他会话更新，本次清空未保存，请刷新页面复核';

function conflict412(version: number) {
  return new ApiError(412, 'Canvas 版本冲突', 412, { version });
}

async function clearToConflict412() {
  apiMocks.saveCanvasDoc.mockRejectedValueOnce(conflict412(5));
  await deleteNodes(['t1']);
  await vi.waitFor(() => {
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.calls[0]![1].confirmEmpty).toBe(true);
    expect(document.body.textContent).toContain(CONFLICT_TOAST);
  }, { timeout: 3000 });
}

describe('IKILUE 412 后阻止旧空文档重发', () => {
  it('a. 清空保存被 412 拒绝后：只发一次 PUT，本地保留清空态，提示刷新复核，后续防抖不再重发', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    expect(flowProps.current.textNodes).toHaveLength(0);

    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
  });

  it('b. 闸门生效期间点「重试保存」不发请求，提示刷新复核', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(CONFLICT_TOAST);
  });

  it('c. 闸门生效期间项目切换前强制保存被中止并提示刷新复核，停留当前项目', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(CONFLICT_TOAST);
    expect(locationRef!.search).toContain('project=p1');
  });

  it('d. 刷新（重新水合服务端新画布）后闸门解除：再次删光的清空保存带 confirmEmpty 正常放行', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await unmountPage();
    seedDoc([{ id: 't2', type: 'textNode', position: { x: 40, y: 40 }, data: { title: '新卡', text: '另一会话的内容' } }]);
    await renderPage();

    await deleteNodes(['t2']);
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2);
      const call = apiMocks.saveCanvasDoc.mock.calls[1]!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBe(true);
    }, { timeout: 3000 });
  });
});

const REJECTED_422_TOAST = '画布内容与服务端不一致，已阻止清空保存，请刷新页面复核';

function rejected422() {
  return new ApiError(422, '画布非空，本次保存会清空全部节点；确认清空请携带 confirmEmpty');
}

describe('IKILUG 画布保存 422 刷新复核提示', () => {
  it('a. 水合为空画布 → 防抖自动保存的空文档（不带 confirmEmpty）收 422 → 提示刷新复核', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());

    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });

    await vi.waitFor(() => {
      const call = apiMocks.saveCanvasDoc.mock.calls.at(-1)!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBeFalsy();
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });
  });

  it('b. 项目切换前强制保存收 422 → 刷新复核提示，中止导航停留当前项目', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValue(rejected422());

    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await act(async () => {});

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });
    expect(locationRef!.search).toContain('project=p1');
    for (const call of apiMocks.saveCanvasDoc.mock.calls) {
      expect(call[0]).toBe('p1');
    }
  });

  it('c. 手动「重试保存」收 422 → 刷新复核提示（而非笼统保存失败）', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new ApiError(500, '服务器开小差'));
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    const findRetry = () => [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    await vi.waitFor(() => {
      expect(findRetry()).toBeTruthy();
    }, { timeout: 3000 });

    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());
    await act(async () => { findRetry()!.click(); });
    await act(async () => {});

    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });
  });

  it('d. 422 后本地编辑保留、保存未当成成功（重试按钮仍在，「已保存」未出现）', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValue(rejected422());
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });

    expect(flowProps.current.textNodes).toHaveLength(0);
    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    expect(document.body.textContent).not.toContain('已保存');
  });
});

describe('IKILTB 422 阻断后项目切换提示刷新复核', () => {
  it('e. 防抖空保存收 422 后点「返回首页」：刷新复核提示（非笼统重试），未再发 PUT，中止导航', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());

    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });

    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(REJECTED_422_TOAST), { timeout: 3000 });
    expect(locationRef!.search).toContain('project=p1');
  });
});

describe('IKIMQK 空基线新增保存成功后允许再次明确清空', () => {

  it('a. 空水合 → 新增 → 非空保存成功获得新版本 → 删光：空保存带 confirmEmpty=true 与该次保存版本', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockResolvedValue({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });

    await addTextNodeViaPaneMenu();
    expect(flowProps.current.textNodes).toHaveLength(1);
    const addedId = flowProps.current.textNodes[0]!.id as string;
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      const call = apiMocks.saveCanvasDoc.mock.calls[0]!;
      expect(call[1].nodes).toHaveLength(1);
      expect(call[1].confirmEmpty).toBeFalsy();
      expect(call[2]).toBe(3);
    }, { timeout: 3000 });

    await deleteNodes([addedId]);
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2);
      const call = apiMocks.saveCanvasDoc.mock.calls[1]!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBe(true);
      expect(call[2]).toBe(4);
    }, { timeout: 3000 });
  }, 10000);

  it('b. 空水合 → 本地新建但非空保存未成功即删光：空保存不带 confirmEmpty', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new ApiError(500, '服务器开小差'));

    await addTextNodeViaPaneMenu();
    const addedId = flowProps.current.textNodes[0]!.id as string;
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(apiMocks.saveCanvasDoc.mock.calls[0]![1].nodes).toHaveLength(1);
    }, { timeout: 3000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    await deleteNodes([addedId]);

    await vi.waitFor(() => {
      const call = apiMocks.saveCanvasDoc.mock.calls.at(-1)!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBeFalsy();
    }, { timeout: 3000 });
  });

  it('c. 412 清空冲突后：本地新增保持非空、再删光均不再发出旧整文档（IKIN23 整文档待复核）', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await addTextNodeViaPaneMenu();
    expect(flowProps.current.textNodes).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    await deleteNodes([flowProps.current.textNodes[0]!.id as string]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
  });

  it('d. 422 拒后：新增又删光、移动视口均不再触发旧整文档保存（IKIN23 整文档待复核）', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValue(rejected422());

    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });

    await addTextNodeViaPaneMenu();
    await deleteNodes([flowProps.current.textNodes[0]!.id as string]);
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 240, y: 0, zoom: 1 });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
  });
});

describe('IKIN23 冲突后整文档待复核阻断陈旧保存', () => {
  it('a. 412 清空冲突后新增保持非空：手动「重试保存」不发 PUT，提示刷新复核', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await addTextNodeViaPaneMenu();
    expect(flowProps.current.textNodes).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(CONFLICT_TOAST), { timeout: 3000 });
  });

  it('b. 412 清空冲突后新增保持非空：返回首页中止并提示刷新复核', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await addTextNodeViaPaneMenu();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(CONFLICT_TOAST), { timeout: 3000 });
    expect(locationRef!.search).toContain('project=p1');
  });

  it('c. 清空保存 412 落地时排在在途保存之后的 flush 执行前复查，仍不发请求', async () => {
    seedDoc([T1]);
    await renderPage();
    let rejectInflight!: (e: unknown) => void;
    apiMocks.saveCanvasDoc.mockImplementationOnce(
      () => new Promise((_, reject) => { rejectInflight = reject; }),
    );
    await deleteNodes(['t1']);

    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(apiMocks.saveCanvasDoc.mock.calls[0]![1].confirmEmpty).toBe(true);
    });

    await act(async () => { exitBtn!.click(); });

    await act(async () => { rejectInflight(conflict412(5)); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(CONFLICT_TOAST);
    expect(locationRef!.search).toContain('project=p1');
  });

  it('d. 422 拒后新增保持非空：防抖自动保存与手动重试均不发旧整文档', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });

    await addTextNodeViaPaneMenu();
    expect(flowProps.current.textNodes).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn!.click(); });
    await act(async () => {});
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(REJECTED_422_TOAST), { timeout: 3000 });
  });

  it('e. 422 拒后新增保持非空：返回首页中止并提示刷新复核', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });

    await addTextNodeViaPaneMenu();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(REJECTED_422_TOAST), { timeout: 3000 });
    expect(locationRef!.search).toContain('project=p1');
  });

  it('f. 加载失败的重新水合不解除待复核；成功重新水合后才以新基线恢复保存', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    canvasDocMock.current = {
      ...canvasDocMock.current,
      doc: { id: null, version: null, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
      loadFailed: true,
    };
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 200, y: 0, zoom: 1 });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn!.click(); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(CONFLICT_TOAST), { timeout: 3000 });

    canvasDocMock.current = {
      ...canvasDocMock.current,
      doc: {
        id: 11,
        version: 7,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{ id: 't2', type: 'textNode', position: { x: 40, y: 40 }, data: { title: '新卡', text: '另一会话的内容' } }],
        edges: [],
      },
      loadFailed: false,
    };
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 260, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(flowProps.current.textNodes.map((n: { id: string }) => n.id)).toEqual(['t2']);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    await deleteNodes(['t2']);
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2);
      const call = apiMocks.saveCanvasDoc.mock.calls[1]!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBe(true);
      expect(call[2]).toBe(7);
    }, { timeout: 3000 });
  }, 10000);

  it('g. 资产字典刷新（doc 引用不变）不解除待复核', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    canvasDocMock.current = {
      ...canvasDocMock.current,
      assets: {
        42: { asset_id: 42, type: 'image', access_url: 'https://example.com/a.png', width: null, height: null, material_id: null, material_status: null },
      },
    };
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 200, y: 0, zoom: 1 });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn!.click(); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(CONFLICT_TOAST), { timeout: 3000 });
  });
});

describe('IKIN8A 待复核期间同页 Project 导航门禁', () => {
  async function navigateSamePage(to: string) {
    await act(async () => { navigateRef!(to); });
    await act(async () => {});
  }

  it('a. 412 清空冲突待复核期间：同页路由切到另一 Project 被中止，地址恢复当前项目，本地编辑保留，无旧整文档 PUT', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await addTextNodeViaPaneMenu();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    await navigateSamePage('/canvas?project=p2');

    expect(locationRef!.search).toContain('project=p1');
    expect(locationRef!.search).not.toContain('project=p2');
    expect(flowProps.current.textNodes.length).toBeGreaterThan(0);
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(CONFLICT_TOAST), { timeout: 3000 });
  }, 10000);

  it('b. 被拒的同页导航不清除待复核：此后手动重试保存仍被拦，仍提示刷新复核', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await navigateSamePage('/canvas?project=p2');
    expect(locationRef!.search).toContain('project=p1');

    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    await act(async () => { retryBtn!.click(); });
    await act(async () => {});
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(CONFLICT_TOAST), { timeout: 3000 });
  }, 10000);

  it('c. 422 空覆盖待复核期间：同页路由切换同样被中止，新增节点保留并提示刷新复核', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });
    await addTextNodeViaPaneMenu();
    expect(flowProps.current.textNodes).toHaveLength(1);

    await navigateSamePage('/canvas?project=p2');

    expect(locationRef!.search).toContain('project=p1');
    expect(flowProps.current.textNodes).toHaveLength(1);
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.textContent).toContain(REJECTED_422_TOAST), { timeout: 3000 });
  }, 10000);

  it('d. 无待复核时同页切换到另一 Project：正常水合新项目、地址指向新项目、可正常保存', async () => {
    seedDoc([T1]);
    await renderPage();

    await navigateSamePage('/canvas?project=p2');
    expect(locationRef!.search).toContain('project=p2');

    const P2T1 = { id: 'p2-t1', type: 'textNode', position: { x: 20, y: 20 }, data: { title: 'B卡', text: '项目二内容' } };
    canvasDocMock.current = {
      doc: { id: 22, version: 9, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [P2T1], edges: [] },
      assets: {},
      refetch: () => Promise.resolve([]),
      acceptDoc: vi.fn(),
      loadFailed: false,
    };
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 60, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(flowProps.current.textNodes.map((n: { id: string }) => n.id)).toEqual(['p2-t1']);
    });

    apiMocks.saveCanvasDoc.mockClear();
    await addTextNodeViaPaneMenu();
    await vi.waitFor(() => {
      const call = apiMocks.saveCanvasDoc.mock.calls.at(-1)!;
      expect(call[0]).toBe('p2');
      expect((call[1].nodes as unknown[]).length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  }, 10000);

  it('e. 待复核期间同项目的其他 query 参数变化：地址不回退、不误拦', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await navigateSamePage('/canvas?project=p1&panel=agent');

    expect(locationRef!.search).toContain('project=p1');
    expect(locationRef!.search).toContain('panel=agent');
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
  }, 10000);
});
