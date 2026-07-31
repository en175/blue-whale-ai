// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import type { ComponentType, ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomDock } from "./BottomDock";

expect.extend(jestDomMatchers);

vi.mock("@/components/SmoothCorners", () => ({
  SmoothCorners: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/credits/CreditBalance", () => ({
  CreditBalance: () => <div>credits</div>,
}));
vi.mock("./ImageDockContent", () => ({
  ImageDockContent: ({
    expanded,
    onToggleExpand,
  }: {
    expanded?: boolean;
    onToggleExpand?: () => void;
  }) => (
    <div>
      image dock
      <button
        type="button"
        aria-label={expanded ? "收起面板" : "放大面板"}
        onClick={onToggleExpand}
      >
        {expanded ? "min" : "max"}
      </button>
    </div>
  ),
}));
vi.mock("./VideoDockContent", () => ({
  VideoDockContent: () => <div>video dock</div>,
}));
vi.mock("./AudioDockContent", () => ({
  AudioDockContent: () => <div>audio dock</div>,
  MOCK_AUDIO_MODEL: { id: "mock-audio-v1", label: "音频模型（mock）" },
  MOCK_MUSIC_MODEL: { id: "mock-music-v1", label: "音乐模型（mock）" },
}));

type LegacyCancellationProps = {
  videoJobStatus?: string | null;
  videoJobError?: string | null;
  onCancelVideoJob?: () => void;
  cancellingVideo?: boolean;
};

const LegacyBottomDock = BottomDock as ComponentType<
  ComponentProps<typeof BottomDock> & LegacyCancellationProps
>;

describe("BottomDock video generation status", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("视频生成中不展示状态取消栏", () => {
    render(
      <LegacyBottomDock
        mode="video"
        onClose={vi.fn()}
        videoJobStatus="processing"
        onCancelVideoJob={vi.fn()}
      />,
    );

    expect(screen.queryByText("视频生成中")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消生成" }),
    ).not.toBeInTheDocument();
  });
});

describe("BottomDock Dock 规范定位契约（IK55VF）", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("底部居中（absolute / bottom:16 / left:50% / translateX(-50%) / 宽 680）且无全屏遮罩", () => {
    const { container } = render(<BottomDock mode="image" onClose={vi.fn()} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveStyle({
      position: "absolute",
      bottom: "16px",
      left: "50%",
      width: "680px",
    });
    expect(root.style.transform).toBe("translateX(-50%)");
    // 无遮罩：组件树内不存在覆盖全屏的 backdrop/overlay 元素，画布可继续交互
    expect(
      container.querySelector(
        '[class*="backdrop"], [class*="overlay"], [data-dock-overlay]',
      ),
    ).toBeNull();
  });
});

describe("BottomDock 点击外部隐藏（IK5OWS）", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function firePointerDown(target: Element) {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  }

  it("点击面板外 → onClose 触发", () => {
    const onClose = vi.fn();
    render(<BottomDock mode="image" onClose={onClose} isOpen />);

    firePointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击面板内部 → 不触发 onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <BottomDock mode="image" onClose={onClose} isOpen />,
    );

    firePointerDown(container.firstElementChild!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("例外①：picking 模式激活时不隐藏", () => {
    const onClose = vi.fn();
    render(<BottomDock mode="image" onClose={onClose} isOpen isPicking />);

    firePointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("例外②：data-tc-dock-popover 浮层上的点击不隐藏", () => {
    const onClose = vi.fn();
    render(<BottomDock mode="image" onClose={onClose} isOpen />);

    const popover = document.createElement("div");
    popover.setAttribute("data-tc-dock-popover", "");
    document.body.appendChild(popover);

    firePointerDown(popover);
    expect(onClose).not.toHaveBeenCalled();

    popover.remove();
  });

  it("例外③：左侧工具栏点击不隐藏", () => {
    const onClose = vi.fn();
    render(<BottomDock mode="image" onClose={onClose} isOpen />);

    const toolbar = document.createElement("aside");
    toolbar.setAttribute("data-tour-target", "creation-sidebar");
    document.body.appendChild(toolbar);

    firePointerDown(toolbar);
    expect(onClose).not.toHaveBeenCalled();

    toolbar.remove();
  });

  it("生成中点击外部照样隐藏", () => {
    const onClose = vi.fn();
    render(<BottomDock mode="image" onClose={onClose} isOpen generating />);

    firePointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("isOpen=false 时不监听点击", () => {
    const onClose = vi.fn();
    render(<BottomDock mode="image" onClose={onClose} isOpen={false} />);

    firePointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("BottomDock 放大态（IK5OWV）", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("点击放大按钮 → 面板居中放大（bottom:calc(50% - 240px) / 宽 960）", () => {
    const { container } = render(<BottomDock mode="image" onClose={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "放大面板" }));

    expect(root.style.bottom).toBe("calc(50% - 240px)");
    expect(root).toHaveStyle({ width: "960px" });
  });

  it("同一按钮 toggle 收起（回 bottom:16 / 宽 680）", () => {
    const { container } = render(<BottomDock mode="image" onClose={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "放大面板" }));
    fireEvent.click(screen.getByRole("button", { name: "收起面板" }));

    expect(root).toHaveStyle({ bottom: "16px", width: "680px" });
  });

  it("Esc 收起回普通态", () => {
    const { container } = render(<BottomDock mode="image" onClose={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "放大面板" }));
    expect(root.style.bottom).toBe("calc(50% - 240px)");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(root).toHaveStyle({ bottom: "16px", width: "680px" });
  });

  it("放大态点击面板外 → 收起而非隐藏（不触发 onClose）", () => {
    const onClose = vi.fn();
    const { container } = render(
      <BottomDock mode="image" onClose={onClose} isOpen />,
    );
    const root = container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "放大面板" }));
    fireEvent.pointerDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
    expect(root).toHaveStyle({ bottom: "16px", width: "680px" });
  });

  it("放大态仅图片 Dock：切到 video 模式自动收起", () => {
    const { container, rerender } = render(
      <BottomDock mode="image" onClose={vi.fn()} />,
    );
    const root = container.firstElementChild as HTMLElement;

    fireEvent.click(screen.getByRole("button", { name: "放大面板" }));
    expect(root.style.bottom).toBe("calc(50% - 240px)");

    rerender(<BottomDock mode="video" onClose={vi.fn()} />);
    expect(root).toHaveStyle({ bottom: "16px", width: "680px" });
  });
});
