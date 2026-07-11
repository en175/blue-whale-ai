// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * CanvasPageInner / gating 守卫测试（IJZLE2）。
 *
 * 未登录直访 /canvas 时，effect 必须 return 保持 gated=true，让页面留 null 直到
 * navigation 卸载——否则 setGated(false) 会让整棵 canvas 树渲染一帧（闪帧 bug）。
 *
 * mock 策略：gating 只依赖 loadUser / useAuth().openLogin / router.replace，
 * 其余 _canvas 子树与 useProject 对本断言无意义，统一 stub，避免耦合真实实现。
 */
const mocks = vi.hoisted(() => ({
  loadUser: vi.fn(),
  openLogin: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/components/auth/authStorage", () => ({
  loadUser: mocks.loadUser,
}));
vi.mock("@/components/auth/AuthContext", () => ({
  useAuth: () => ({ openLogin: mocks.openLogin }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("./_canvas", () => ({
  // 字段齐全：render 阶段（L299 nodes.filter）与 mount effect 会立即访问派生值，
  // 未登录 case 虽 return null，但函数体顶部的派生计算仍先跑。
  useProject: () => ({
    projects: [],
    activeProject: {
      id: "1",
      name: "t",
      canvas: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } },
      messages: [],
    },
    nodes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    messages: [],
    selectProject: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    setViewport: vi.fn(),
    setNodes: vi.fn(),
    addNode: vi.fn(),
    appendMessages: vi.fn(),
    setCardStatus: vi.fn(),
  }),
  TopBar: () => null,
  TopBarCenter: () => null,
  TopBarRight: () => null,
  LeftToolbar: () => null,
  CanvasSurface: () => null,
  BottomDock: () => null,
  AgentChatPanel: () => null,
  ZoomControls: () => null,
  nodeFromCard: vi.fn(),
}));

import { CanvasPageInner } from "./page";

describe("CanvasPageInner / 未登录 gating", () => {
  beforeEach(() => {
    mocks.loadUser.mockReset();
    mocks.openLogin.mockReset();
    mocks.replace.mockReset();
  });

  it("未登录直访：保持 gated=true 返回 null，跳 / 并弹登录，不渲染画布内容", () => {
    mocks.loadUser.mockReturnValue(null);

    const { container } = render(<CanvasPageInner />);

    // gated 未被翻 false → 页面留 null（container 无子节点），杜绝闪帧
    expect(container.firstChild).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/");
    expect(mocks.openLogin).toHaveBeenCalledTimes(1);
  });
});

// 已登录 gating 分支（IJZLE5）：IJZLE2 只覆盖未登录分支，
// 此处补 loadUser 返回 user 时的守卫——不 replace、不 openLogin。
// 断言守卫副作用，不断 DOM（_canvas 子树统一 stub null 组件，无可见内容）。
describe("CanvasPageInner / 已登录 gating", () => {
  beforeEach(() => {
    mocks.loadUser.mockReset();
    mocks.openLogin.mockReset();
    mocks.replace.mockReset();
  });

  it("已登录直访：守卫不触发，不 replace 不 openLogin", () => {
    mocks.loadUser.mockReturnValue({ phone: "13800001234" });

    render(<CanvasPageInner />);

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.openLogin).not.toHaveBeenCalled();
  });
});
