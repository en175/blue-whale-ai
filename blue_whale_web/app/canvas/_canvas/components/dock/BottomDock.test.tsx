// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import type { ComponentType, ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomDock } from "./BottomDock";

expect.extend(jestDomMatchers);

vi.mock("@/components/SmoothCorners", () => ({
  SmoothCorners: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/credits/CreditBalance", () => ({
  CreditBalance: () => <div>credits</div>,
}));
vi.mock("./ImageDockContent", () => ({ ImageDockContent: () => <div>image dock</div> }));
vi.mock("./VideoDockContent", () => ({ VideoDockContent: () => <div>video dock</div> }));
vi.mock("./AudioDockContent", () => ({ AudioDockContent: () => <div>audio dock</div> }));

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
    expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
  });
});
