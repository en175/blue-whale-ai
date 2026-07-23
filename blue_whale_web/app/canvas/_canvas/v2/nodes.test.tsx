// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaStateBody } from "./nodes";

/**
 * v2 MediaStateBody 单测：音频占位渲染（IJZY0Z「音频有占位展示」，无播放控件）+
 * 视频首帧封面（preload=metadata + 首帧就绪前占位防黑）。纯展示组件，无 RF/store 依赖。
 */
describe("MediaStateBody / audio 播放", () => {
  it("audio 有 src：渲染 AudioPlayer（<audio preload=metadata> + 控制条），可播放", () => {
    const { container } = render(<MediaStateBody kind="audio" status="done" src="https://tos/a.mp3" content="旁白.mp3" />);
    expect(screen.getByTestId("node-audio-player")).toBeInTheDocument();
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("https://tos/a.mp3");
    expect(audio?.getAttribute("preload")).toBe("metadata");
  });

  it("audio 无 src：占位（图标 + 名称）", () => {
    const { container } = render(<MediaStateBody kind="audio" status="done" content="旁白.mp3" />);
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
    const { container } = render(<MediaStateBody kind="video" status="done" src="https://tos/a.mp4" content="风景" />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(screen.getByTestId("video-frame-pending")).toBeInTheDocument();
  });

  it("video 静音按钮切换 muted（IJZY1V）", () => {
    const { container } = render(<MediaStateBody kind="video" status="done" src="https://tos/a.mp4" />);
    const video = container.querySelector("video");
    expect(video?.muted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "静音" }));
    expect(video?.muted).toBe(true);
    expect(screen.getByRole("button", { name: "取消静音" })).toBeInTheDocument();
  });
});

describe("MediaStateBody / image 回归", () => {
  it("image ready：仍渲染 <img>", () => {
    const { container } = render(<MediaStateBody kind="image" status="done" src="https://tos/a.png" content="猫" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://tos/a.png");
  });
});
