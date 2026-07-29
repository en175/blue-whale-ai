// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { apiFetch } from "@/lib/api-client";
import { MediaStateBody } from "./nodes";

vi.mock("@/lib/api-client", () => ({ apiFetch: vi.fn() }));

/**
 * v2 MediaStateBody 单测：音频占位渲染（IJZY0Z「音频有占位展示」，无播放控件）+
 * 视频首帧封面（preload=metadata + 首帧就绪前占位防黑）。纯展示组件，无 RF/store 依赖。
 */
describe("MediaStateBody / audio 播放", () => {
  it("running 使用与媒体来源无关的处理中占位文案", () => {
    render(<MediaStateBody kind="image" status="running" content="cat.png" />);

    expect(screen.getByTestId("node-loading")).toBeInTheDocument();
    expect(screen.getByText("处理中…")).toBeInTheDocument();
  });

  it("audio 有 src：渲染 AudioPlayer（<audio preload=metadata> + 控制条），可播放", () => {
    const { container } = render(
      <MediaStateBody
        kind="audio"
        status="done"
        src="https://tos/a.mp3"
        content="旁白.mp3"
      />,
    );
    expect(screen.getByTestId("node-audio-player")).toBeInTheDocument();
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("https://tos/a.mp3");
    expect(audio?.getAttribute("preload")).toBe("metadata");
  });

  it("audio 无 src：占位（图标 + 名称）", () => {
    const { container } = render(
      <MediaStateBody kind="audio" status="done" content="旁白.mp3" />,
    );
    expect(screen.getByTestId("node-audio")).toBeInTheDocument();
    expect(screen.getByText("旁白.mp3")).toBeInTheDocument();
    expect(container.querySelector("audio")).toBeNull();
  });

  it("audio 无 src 无名称：默认文案「音频节点」", () => {
    render(<MediaStateBody kind="audio" status="done" />);
    expect(screen.getByText("音频节点")).toBeInTheDocument();
  });
});

describe("MediaStateBody / video 首帧封面", () => {
  it("video ready：<video preload=metadata>，首帧就绪前显占位防黑", () => {
    const { container } = render(
      <MediaStateBody
        kind="video"
        status="done"
        src="https://tos/a.mp4"
        content="风景"
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(screen.getByTestId("video-frame-pending")).toBeInTheDocument();
  });

  it("video 静音按钮切换 muted（IJZY1V）", () => {
    const { container } = render(
      <MediaStateBody kind="video" status="done" src="https://tos/a.mp4" />,
    );
    const video = container.querySelector("video");
    expect(video?.muted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "静音" }));
    expect(video?.muted).toBe(true);
    expect(
      screen.getByRole("button", { name: "取消静音" }),
    ).toBeInTheDocument();
  });
});

describe("MediaStateBody / 上传占位卡（origin=uploaded，IK55VE 变体 C）", () => {
  it("running：本地缩略图 + 遮罩 + 进度环 + 百分比 + 「上传中」", () => {
    const { container } = render(
      <MediaStateBody
        kind="image"
        status="running"
        origin="uploaded"
        previewUrl="blob:preview-1"
        progress={42}
        content="cat.png"
      />,
    );

    expect(screen.getByTestId("upload-card-running")).toBeInTheDocument();
    expect(screen.getByText("上传中")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull(); // 进度环
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:preview-1");
    // 不渲染旧的生成中占位
    expect(screen.queryByTestId("node-loading")).toBeNull();
  });

  it("running：图片上传也显示百分比（不再限 video）", () => {
    render(
      <MediaStateBody
        kind="image"
        status="running"
        origin="uploaded"
        progress={7}
      />,
    );
    expect(screen.getByText("7%")).toBeInTheDocument();
  });

  it("running：视频缩略图用 <video muted playsInline preload=metadata> 显示首帧", () => {
    const { container } = render(
      <MediaStateBody
        kind="video"
        status="running"
        origin="uploaded"
        previewUrl="blob:preview-v"
        progress={10}
      />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("blob:preview-v");
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("error：错误遮罩 + 重试/移除圆钮，点击分别触发 onRetry/onRemove", () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(
      <MediaStateBody
        kind="image"
        status="error"
        origin="uploaded"
        previewUrl="blob:preview-1"
        errorMessage="上传失败，请稍后重试"
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByTestId("upload-card-error")).toBeInTheDocument();
    expect(screen.getByText("上传失败，请稍后重试")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    // 不渲染旧的错误占位
    expect(screen.queryByTestId("node-error")).toBeNull();
  });

  it("生成卡（origin=generated）running 维持旧外观", () => {
    render(<MediaStateBody kind="image" status="running" origin="generated" />);
    expect(screen.getByTestId("node-loading")).toBeInTheDocument();
    expect(screen.getByText("处理中…")).toBeInTheDocument();
  });

  it("生成卡（origin=generated）error 维持旧外观（无移除按钮）", () => {
    render(
      <MediaStateBody
        kind="image"
        status="error"
        origin="generated"
        errorMessage="生成失败"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("node-error")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除" })).toBeNull();
  });
});

describe("MediaStateBody / image 回归", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:canvas-asset-200"),
      revokeObjectURL: vi.fn(),
    });
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(new Blob(["fake-image"], { type: "image/png" }), {
        status: 200,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("image ready：仍渲染 <img>", () => {
    const { container } = render(
      <MediaStateBody
        kind="image"
        status="done"
        src="https://tos/a.png"
        content="猫"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://tos/a.png");
  });

  it("项目私有图片通过认证请求加载为 Blob URL", async () => {
    render(
      <MediaStateBody
        kind="image"
        status="done"
        src="/api/projects/55/assets/200/content"
        content="上传图片"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "上传图片" })).toHaveAttribute(
        "src",
        "blob:canvas-asset-200",
      ),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/projects/55/assets/200/content",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("MediaStateBody / 视频生成中进度与取消（IK55VL）", () => {
  it("video running 带 progress：显示「处理中 X%」", () => {
    render(<MediaStateBody kind="video" status="running" progress={45} />);
    expect(screen.getByTestId("node-loading")).toBeInTheDocument();
    expect(screen.getByText("处理中 45%")).toBeInTheDocument();
  });

  it("提供 onCancel：渲染「取消生成」入口，点击触发 onCancel", () => {
    const onCancel = vi.fn();
    render(
      <MediaStateBody
        kind="video"
        status="running"
        progress={45}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("未提供 onCancel：不渲染取消入口（image / 无 taskId 场景）", () => {
    render(<MediaStateBody kind="image" status="running" />);
    expect(screen.queryByRole("button", { name: "取消生成" })).toBeNull();
  });
});
