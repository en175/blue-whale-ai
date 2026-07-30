// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VideoDockContentProps } from "../../types";
import { VideoDockContent } from "./VideoDockContent";

expect.extend(jestDomMatchers);

function props(
  overrides: Partial<VideoDockContentProps> = {},
): VideoDockContentProps {
  return {
    editorRef: createRef<HTMLDivElement>(),
    isEmpty: false,
    onInput: vi.fn(),
    onClose: vi.fn(),
    refMode: { id: "omni", label: "全能参考" },
    setRefMode: vi.fn(),
    refModeOpen: false,
    setRefModeOpen: vi.fn(),
    selectedModel: { id: "seedance-2", label: "Seedance 2.0" },
    setSelectedModel: vi.fn(),
    modelSettingsOpen: false,
    setModelSettingsOpen: vi.fn(),
    aspectRatio: { id: "16:9", label: "16:9" },
    setAspectRatio: vi.fn(),
    resolution: { id: "720p", label: "720p" },
    setResolution: vi.fn(),
    duration: 8,
    setDuration: vi.fn(),
    quantity: "1x",
    setQuantity: vi.fn(),
    quantityOpen: false,
    setQuantityOpen: vi.fn(),
    advancedOpen: false,
    setAdvancedOpen: vi.fn(),
    internetSearch: false,
    setInternetSearch: vi.fn(),
    models: [{ id: "seedance-2", label: "Seedance 2.0" }],
    ...overrides,
  };
}

describe("VideoDockContent references", () => {
  afterEach(() => cleanup());

  it("offers a working MP4/MOV upload entry and no audio reference entry", () => {
    const onLocalUpload = vi.fn();
    const { container } = render(
      <VideoDockContent {...props({ onLocalUpload })} />,
    );

    expect(screen.queryByRole("button", { name: "音频" })).toBeNull();
    const button = screen.getByRole("button", { name: "视频" });
    fireEvent.click(button);
    const input = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ).find((candidate) => candidate.accept.includes("video/quicktime"));
    expect(input?.accept).toBe(".mp4,.mov,video/mp4,video/quicktime");

    const file = new File(["video"], "reference.mov", {
      type: "video/quicktime",
    });
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onLocalUpload).toHaveBeenCalledWith(file);
  });

  it("offers canvas selection from the video reference source menu", () => {
    const onPickFromCanvas = vi.fn();
    render(<VideoDockContent {...props({ onPickFromCanvas })} />);

    fireEvent.click(screen.getByRole("button", { name: "参考图片" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从画布选择" }));

    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
  });

  it("only exposes model-supported options and quantity", () => {
    render(
      <VideoDockContent
        {...props({
          selectedModel: {
            id: "doubao-seedance-2-0-fast-260128",
            label: "Seedance 2.0 Fast",
          },
          models: [
            {
              id: "doubao-seedance-2-0-fast-260128",
              label: "Seedance 2.0 Fast",
            },
          ],
          resolutions: [{ id: "480p", label: "480p" }],
          aspectRatios: [{ id: "9:16", label: "9:16" }],
          quantityMax: 1,
          quantityOpen: true,
        })}
      />,
    );

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "1x" })).toBeInTheDocument();
  });
});

describe("VideoDockContent 首尾帧槽（IK55VL）", () => {
  afterEach(() => cleanup());

  const frameProps = (overrides: Partial<VideoDockContentProps> = {}) =>
    props({
      refMode: { id: "first-last", label: "首尾帧" },
      onFrameUpload: vi.fn(),
      onFrameClear: vi.fn(),
      onSwapFrames: vi.fn(),
      onPickFrameFromCanvas: vi.fn(),
      ...overrides,
    });

  it("first-last 模式渲染首帧/尾帧槽；非 first-last 不渲染", () => {
    const { unmount } = render(<VideoDockContent {...frameProps()} />);
    expect(screen.getByRole("button", { name: "首帧" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "尾帧" })).toBeInTheDocument();
    unmount();

    render(
      <VideoDockContent
        {...frameProps({ refMode: { id: "omni", label: "全能参考" } })}
      />,
    );
    expect(screen.queryByRole("button", { name: "首帧" })).toBeNull();
    expect(screen.queryByRole("button", { name: "尾帧" })).toBeNull();
  });

  it("本地上传入槽：首帧文件进入 onFrameUpload(file, 'first')", () => {
    const onFrameUpload = vi.fn();
    const { container } = render(
      <VideoDockContent {...frameProps({ onFrameUpload })} />,
    );
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ).filter((candidate) => candidate.accept.includes("image/jpeg"));
    expect(inputs).toHaveLength(2);

    const file = new File(["img"], "first.png", { type: "image/png" });
    fireEvent.change(inputs[0], { target: { files: [file] } });
    expect(onFrameUpload).toHaveBeenCalledWith(file, "first");

    fireEvent.change(inputs[1], { target: { files: [file] } });
    expect(onFrameUpload).toHaveBeenCalledWith(file, "last");
  });

  it("已填槽显示预览，清除按钮触发 onFrameClear", () => {
    const onFrameClear = vi.fn();
    render(
      <VideoDockContent
        {...frameProps({
          firstFrameUrl: "https://tos/first.png",
          onFrameClear,
        })}
      />,
    );
    expect(screen.getByRole("img", { name: "首帧" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除首帧" }));
    expect(onFrameClear).toHaveBeenCalledWith("first");
  });

  it("交换按钮触发 onSwapFrames", () => {
    const onSwapFrames = vi.fn();
    render(<VideoDockContent {...frameProps({ onSwapFrames })} />);
    fireEvent.click(screen.getByRole("button", { name: "交换首尾帧" }));
    expect(onSwapFrames).toHaveBeenCalledTimes(1);
  });

  it("画布选取入槽：触发 onPickFrameFromCanvas(slot)", () => {
    const onPickFrameFromCanvas = vi.fn();
    render(<VideoDockContent {...frameProps({ onPickFrameFromCanvas })} />);
    fireEvent.click(screen.getByRole("button", { name: "从画布选择首帧" }));
    expect(onPickFrameFromCanvas).toHaveBeenCalledWith("first");
    fireEvent.click(screen.getByRole("button", { name: "从画布选择尾帧" }));
    expect(onPickFrameFromCanvas).toHaveBeenCalledWith("last");
  });
});
