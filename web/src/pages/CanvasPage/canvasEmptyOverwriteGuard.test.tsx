// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  locationRef,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

/* IKIIWN 画布空覆盖防护页面级链路：自动保存只在「本会话成功水合（非 loadFailed）」后发起；
   空保存的 confirmEmpty 只授予水合基线非空的会话（用户显式删光场景）。
   服务端 422 兜底（水合进来即为空的空提交不带标记被拒）由 canvas.service / canvas.test 覆盖。
   IKILUE 追加：confirmEmpty 空保存被 412 冲突信封拒绝后登记清空待复核闸门——空文档不再
   自动/手动发出（防旧空文档覆盖另一会话的新画布），本地保留清空态、入口提示刷新复核；
   重新水合后闸门解除、confirmEmpty 按新基线重新授予。
   IKILUG 追加：空保存被 422 拒后，防抖自动保存/项目切换强制保存/手动「重试保存」
   三个入口统一提示刷新复核（不再笼统「保存失败，请重试」），本地编辑保留、不当成保存成功。
   IKILTB 追加：422 阻断置 saveBlocked 后的项目切换/返回首页也不再引导注定再 422 的
   无效重试，改提示刷新复核并中止导航；412/422 toast 三分叉收拢为共享 helper。
   IKIMQK 追加：confirmEmpty 授予依据从「仅水合基线非空」扩展为「水合基线非空，或本会话
   成功保存非空文档并取得新版本」——空水合 → 新增 → 非空保存成功 → 再明确删光是合法例外；
   412 清空待复核闸门与 422 阻断语义不变（不因一次本地状态变化绕过刷新复核）。 */

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

/* IKILUE：412 后阻止旧空文档重发（清空待复核闸门） */
const CONFLICT_TOAST = '画布已被其他会话更新，本次清空未保存，请刷新页面复核';

/** 412 版本冲突信封（口径同后端实返：ApiError status=412 + msg + data.version） */
function conflict412(version: number) {
  return new ApiError(412, 'Canvas 版本冲突', 412, { version });
}

/** 水合非空基线 → 删光 → 自动保存带 confirmEmpty 被 412 拒绝 → 等闸门生效（toast 出现） */
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

    // 本地编辑保留：画布保持用户删光后的样子（不回滚）
    expect(flowProps.current.textNodes).toHaveLength(0);

    // 412 后再动一次空画布（viewport 变化触发防抖重跑），等超过一个防抖周期确认闸门拦截
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

    // 「返回首页」与项目切换共用 ensureSavedBeforeProjectSwitch 落盘闸门
    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1); // 未再发起空保存
    expect(document.body.textContent).toContain(CONFLICT_TOAST);
    expect(locationRef!.search).toContain('project=p1'); // 中止导航，停留当前项目
  });

  it('d. 刷新（重新水合服务端新画布）后闸门解除：再次删光的清空保存带 confirmEmpty 正常放行', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    // 模拟刷新：卸载页面，以服务端最新画布（另一会话已保存新节点）重新水合
    await unmountPage();
    seedDoc([{ id: 't2', type: 'textNode', position: { x: 40, y: 40 }, data: { title: '新卡', text: '另一会话的内容' } }]);
    await renderPage();

    await deleteNodes(['t2']);
    // 必须等第二次 PUT 真正发出（第一次 412 的调用同样是空文档带 confirmEmpty，不能只看 at(-1)）
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2);
      const call = apiMocks.saveCanvasDoc.mock.calls[1]!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBe(true);
    }, { timeout: 3000 });
  });
});

/* IKILUG：统一画布保存 422 的刷新复核提示 */
const REJECTED_422_TOAST = '画布内容与服务端不一致，已阻止清空保存，请刷新页面复核';

/** 空覆盖被拒的 422 信封（口径同后端实返：ApiError status=422 + msg，data 无版本可对齐） */
function rejected422() {
  return new ApiError(422, '画布非空，本次保存会清空全部节点；确认清空请携带 confirmEmpty');
}

describe('IKILUG 画布保存 422 刷新复核提示', () => {
  it('a. 水合为空画布 → 防抖自动保存的空文档（不带 confirmEmpty）收 422 → 提示刷新复核', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());

    // viewport 变化驱动防抖发出空文档 PUT（水合基线为空 → confirmEmpty 不授予）
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
    // 全部 PUT 均拒：防抖计时器与 flush 竞争首发时，任何一方收到 422 提示与中止行为都应一致
    apiMocks.saveCanvasDoc.mockRejectedValue(rejected422());

    // viewport 变化制造未落盘编辑后立即点「返回首页」（与项目切换共用 ensureSavedBeforeProjectSwitch）
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
    expect(locationRef!.search).toContain('project=p1'); // 中止导航，停留当前项目
    // 未把空文档 PUT 发到错误目标
    for (const call of apiMocks.saveCanvasDoc.mock.calls) {
      expect(call[0]).toBe('p1');
    }
  });

  it('c. 手动「重试保存」收 422 → 刷新复核提示（而非笼统保存失败）', async () => {
    seedDoc([]);
    await renderPage();
    // 防抖首发 mock 500 进入 error 态（该路径仍是笼统文案），重试链路再收 422
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

    // 本地工作副本保留：画布仍保持用户的空文档形态，未被覆盖/回滚（viewport prop 不反映实时编辑，不在此断言）
    expect(flowProps.current.textNodes).toHaveLength(0);
    // 未当成成功：saveStatus 停在 error（重试按钮仍在），「已保存」未出现
    const retryBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === '重试保存');
    expect(retryBtn).toBeTruthy();
    expect(document.body.textContent).not.toContain('已保存');
  });
});

/* IKILTB（code-review 修订）：防抖空保存收 422 置 saveBlocked 后，项目切换/返回首页的
   saveBlocked 拦截分支提示刷新复核而非笼统「保存失败，请重试」（重试注定再 422），
   且中止导航停留当前项目。 */
describe('IKILTB 422 阻断后项目切换提示刷新复核', () => {
  it('e. 防抖空保存收 422 后点「返回首页」：刷新复核提示（非笼统重试），未再发 PUT，中止导航', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(rejected422());

    // viewport 变化驱动防抖发出空文档 PUT（水合基线为空 → confirmEmpty 不授予）收 422 置阻断
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });

    // toast 为单例替换（data-testid=canvas-toast；「保存失败，请重试」另为面板内静态提示条，
    // 与 toast 无关）：点「返回首页」（与项目切换共用 ensureSavedBeforeProjectSwitch）后，
    // saveBlocked 拦截分支必弹其一——断言 toast 文案为刷新复核而非笼统重试
    const exitBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('返回首页'));
    expect(exitBtn).toBeTruthy();
    await act(async () => { exitBtn!.click(); });
    await act(async () => {});

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1); // saveBlocked 拦截分支未再发 PUT
    expect(document.querySelector('[data-testid="canvas-toast"]')?.textContent).toContain(REJECTED_422_TOAST);
    expect(locationRef!.search).toContain('project=p1'); // 中止导航，停留当前项目
  });
});

/* IKIMQK：空基线新增后允许再次明确清空——confirmEmpty 授予依据扩展为「水合基线非空，
   或本会话成功保存非空文档并取得新版本」；412/422 阻断语义不变。 */
describe('IKIMQK 空基线新增保存成功后允许再次明确清空', () => {
  /** 右键面板菜单「添加节点 → 文本」新增文本卡（空画布起步的用户新增操作路径） */
  async function addTextNodeViaPaneMenu() {
    await act(async () => {
      flowProps.current.onPaneContextMenu({ clientX: 10, clientY: 10 });
    });
    const addItem = [...document.querySelectorAll('button')].find((b) => b.textContent === '添加节点');
    expect(addItem).toBeTruthy();
    await act(async () => {
      // React onMouseEnter 由 mouseover 冒泡合成（口径同 cardRename 既有先例）
      addItem!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    const textItem = [...document.querySelectorAll('button')].find((b) => b.textContent === '文本');
    expect(textItem).toBeTruthy();
    await act(async () => {
      textItem!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  it('a. 空水合 → 新增 → 非空保存成功获得新版本 → 删光：空保存带 confirmEmpty=true 与该次保存版本', async () => {
    seedDoc([]);
    await renderPage();
    // 显式声明保存成功语义（vi.clearAllMocks 不清除历史 mockRejectedValue 的持久实现）
    apiMocks.saveCanvasDoc.mockResolvedValue({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });

    await addTextNodeViaPaneMenu();
    expect(flowProps.current.textNodes).toHaveLength(1);
    const addedId = flowProps.current.textNodes[0]!.id as string;
    // 第一次保存：非空文档不带确认标记，If-Match 用水合版本 3
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      const call = apiMocks.saveCanvasDoc.mock.calls[0]!;
      expect(call[1].nodes).toHaveLength(1);
      expect(call[1].confirmEmpty).toBeFalsy();
      expect(call[2]).toBe(3);
    }, { timeout: 3000 });

    await deleteNodes([addedId]);
    // 第二次保存：空文档携带 confirmEmpty=true，版本用该次成功非空保存返回的 4（非水合版本 3）
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
    // 非空保存失败（500）：本会话从未成功保存过非空文档
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new ApiError(500, '服务器开小差'));

    await addTextNodeViaPaneMenu();
    const addedId = flowProps.current.textNodes[0]!.id as string;
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(apiMocks.saveCanvasDoc.mock.calls[0]![1].nodes).toHaveLength(1);
    }, { timeout: 3000 });
    // 等失败 settle（在途守卫释放、签名已重置），再删光触发空保存
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    await deleteNodes([addedId]);

    await vi.waitFor(() => {
      const call = apiMocks.saveCanvasDoc.mock.calls.at(-1)!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBeFalsy(); // 非空保存尚未成功 → 不授予确认标记
    }, { timeout: 3000 });
  });

  it('c. 412 清空冲突后：本地新增并成功非空保存、再删光——闸门仍拦旧空文档，须重新水合复核', async () => {
    seedDoc([T1]);
    await renderPage();
    await clearToConflict412();

    await addTextNodeViaPaneMenu();
    // 闸门只拦空文档：非空保存正常发出并成功（版本对齐服务端）
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2);
      expect(apiMocks.saveCanvasDoc.mock.calls[1]![1].nodes.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // 再删光：即便本会话刚成功保存过非空文档，旧清空命令的闸门不因本地状态变化解除
    await deleteNodes([flowProps.current.textNodes[0]!.id as string]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(2); // 旧空文档未重发
  });

  it('d. 422 拒后：同一防抖窗口内新增又删光（非空保存从未成功）的空保存仍不带 confirmEmpty', async () => {
    seedDoc([]);
    await renderPage();
    apiMocks.saveCanvasDoc.mockRejectedValue(rejected422());

    // 初始空画布的空保存（viewport 变化）收 422 → 置阻断
    await act(async () => {
      flowProps.current.onViewportChange?.({ x: 120, y: 0, zoom: 1 });
    });
    await vi.waitFor(() => {
      expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(REJECTED_422_TOAST);
    }, { timeout: 3000 });

    // 一次本地状态变化：新增→删光（同一防抖窗口内，非空保存从未发出/成功）
    await addTextNodeViaPaneMenu();
    await deleteNodes([flowProps.current.textNodes[0]!.id as string]);
    await vi.waitFor(() => {
      const call = apiMocks.saveCanvasDoc.mock.calls.at(-1)!;
      expect(call[1].nodes).toHaveLength(0);
      expect(call[1].confirmEmpty).toBeFalsy(); // 未成功保存非空 → 不授予，仍走刷新复核
    }, { timeout: 3000 });
  });
});
