// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childProps = vi.hoisted(() => ({
  image: null as null | {
    onGenerate?: (settings: object) => void;
    onMaxReferenceImagesChange?: (max: number) => void;
  },
  video: null as null | { onGenerate?: (settings: object) => void },
}));

vi.mock("@/components/SmoothCorners", () => ({
  SmoothCorners: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("./ImageDockContent", () => ({
  ImageDockContent: (props: {
    onGenerate?: (settings: object) => void;
    onMaxReferenceImagesChange?: (max: number) => void;
  }) => {
    childProps.image = props;
    return <button onClick={() => props.onGenerate?.({})}>submit image</button>;
  },
}));
vi.mock("./VideoDockContent", () => ({
  VideoDockContent: (props: {
    onGenerate?: (settings: object) => void;
    setRefMode: (mode: { id: string; label: string }) => void;
  }) => {
    childProps.video = props;
    return (
      <>
        <button
          onClick={() =>
            props.setRefMode({ id: "first-last", label: "首尾帧" })
          }
        >
          use frames
        </button>
        <button onClick={() => props.onGenerate?.({})}>submit video</button>
      </>
    );
  },
}));
vi.mock("./AudioDockContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AudioDockContent")>();
  return {
    ...actual,
    AudioDockContent: () => <div>audio dock</div>,
  };
});

import { BottomDock } from "./BottomDock";

describe("BottomDock reference validation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("blocks image submission when more than four reference Assets are selected", () => {
    const onGenerate = vi.fn();
    const onGenerateError = vi.fn();
    render(
      <BottomDock
        mode="image"
        onClose={vi.fn()}
        onGenerate={onGenerate}
        onGenerateError={onGenerateError}
        imageMedia={Array.from({ length: 5 }, (_, index) => ({
          id: `node-${index}`,
          type: "image",
          name: "",
          assetId: String(index + 1),
        }))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "submit image" }));

    expect(onGenerateError).toHaveBeenCalledWith("图片生成最多支持 4 张参考图");
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("blocks last-frame-only video submission before creating a Job", () => {
    const onGenerate = vi.fn();
    const onGenerateError = vi.fn();
    render(
      <BottomDock
        mode="video"
        onClose={vi.fn()}
        onGenerate={onGenerate}
        onGenerateError={onGenerateError}
        lastFrameAssetId={42}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "use frames" }));
    fireEvent.click(screen.getByRole("button", { name: "submit video" }));

    expect(onGenerateError).toHaveBeenCalledWith("请先添加首帧，再添加尾帧");
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("allows more references when model reports higher max (IK5OWU dynamic limit)", () => {
    const onGenerate = vi.fn();
    const onGenerateError = vi.fn();
    render(
      <BottomDock
        mode="image"
        onClose={vi.fn()}
        onGenerate={onGenerate}
        onGenerateError={onGenerateError}
        imageMedia={Array.from({ length: 5 }, (_, index) => ({
          id: `node-${index}`,
          type: "image",
          name: "",
          src: `https://tos.example.com/img-${index}.png`,
          assetId: String(index + 1),
        }))}
      />,
    );

    act(() => {
      childProps.image?.onMaxReferenceImagesChange?.(10);
    });

    fireEvent.click(screen.getByRole("button", { name: "submit image" }));

    expect(onGenerateError).not.toHaveBeenCalled();
    expect(onGenerate).toHaveBeenCalled();
  });
});
