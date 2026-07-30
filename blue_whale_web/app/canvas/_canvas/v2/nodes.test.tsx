// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { apiFetch } from "@/lib/api-client";
import type { CanvasNode } from "../model";
import { MediaStateBody, TextNode } from "./nodes";

vi.mock("@/lib/api-client", () => ({ apiFetch: vi.fn() }));
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    NodeToolbar: ({
      children,
      isVisible,
    }: {
      children: ReactNode;
      isVisible?: boolean;
    }) => (isVisible ? <>{children}</> : null),
  };
});

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

describe("TextNode / 素材信息", () => {
  it("选中无媒体节点时可打开信息面板并显示无媒体信息", () => {
    const props = {
      id: "qa_text",
      data: { kind: "text", content: "无媒体节点" },
      width: 240,
      height: 120,
      selected: true,
    } as unknown as Parameters<typeof TextNode>[0];

    render(
      <ReactFlowProvider>
        <TextNode {...props} />
      </ReactFlowProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "信息" }));

    expect(screen.getByRole("dialog", { name: "素材信息" })).toBeInTheDocument();
    expect(screen.getByText("无媒体信息")).toBeInTheDocument();
  });
});
