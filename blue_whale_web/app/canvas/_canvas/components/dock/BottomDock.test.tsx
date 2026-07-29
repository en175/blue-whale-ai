// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
  ImageDockContent: () => <div>image dock</div>,
}));
vi.mock("./VideoDockContent", () => ({
  VideoDockContent: () => <div>video dock</div>,
}));
vi.mock("./AudioDockContent", () => ({
  AudioDockContent: () => <div>audio dock</div>,
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
