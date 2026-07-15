// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaStateBody } from "./CanvasNodes";

/**
 * MediaStateBody 单测：loading/error/ready 三态 × image/video（design D3/D14/D15/D16）。
 * 纯展示组件，无 RF 依赖，直接 render 即可（不经 ReactFlow）。
 */

describe("MediaStateBody / loading 态", () => {
  it("图片 loading：渲染 spinner 区 + 生成中文案，不渲染 img/video", () => {
    const { container } = render(
      <MediaStateBody type="image" status="loading" content="一只猫" />
    );
    expect(screen.getByTestId("node-loading")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText(/生成中/)).toBeInTheDocument();
  });

  it("视频 loading：显示 progress 百分比（D16）", () => {
    render(<MediaStateBody type="video" status="loading" progress={45} />);
    expect(screen.getByText(/生成中 45%/)).toBeInTheDocument();
  });

  it("视频 loading 无 progress：回退纯文案（不显百分比）", () => {
    render(<MediaStateBody type="video" status="loading" />);
    expect(screen.getByText(/生成中/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("图片 loading 即使带 progress 也不显百分比（progress 仅视频）", () => {
    render(<MediaStateBody type="image" status="loading" progress={80} />);
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe("MediaStateBody / error 态 (D3)", () => {
  it("渲染 errorMessage + 重试按钮，点击调 onRetry", () => {
    const onRetry = vi.fn();
    render(<MediaStateBody type="image" status="error" errorMessage="请求超时" onRetry={onRetry} />);
    expect(screen.getByText("请求超时")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("node-retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("无 errorMessage 显示默认失败文案", () => {
    render(<MediaStateBody type="image" status="error" />);
    expect(screen.getByText("生成失败")).toBeInTheDocument();
  });

  it("video error 同样渲染重试按钮", () => {
    const onRetry = vi.fn();
    render(<MediaStateBody type="video" status="error" errorMessage="视频生成失败" onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId("node-retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("MediaStateBody / ready 态", () => {
  it("image ready：渲染 img 且 src 正确", () => {
    const { container } = render(
      <MediaStateBody type="image" status="ready" imageUrl="https://tos/a.png" content="猫" />
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://tos/a.png");
    expect(img?.getAttribute("alt")).toBe("猫");
  });

  it("video ready：渲染 <video> 元素", () => {
    const { container } = render(
      <MediaStateBody type="video" status="ready" imageUrl="https://tos/a.mp4" content="风景" />
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("https://tos/a.mp4");
  });

  it("status 省略视为 ready（兼容旧数据：旧节点无 status 字段）", () => {
    const { container } = render(<MediaStateBody type="image" imageUrl="https://tos/a.png" />);
    expect(container.querySelector("img")).not.toBeNull();
    expect(screen.queryByTestId("node-loading")).toBeNull();
    expect(screen.queryByTestId("node-error")).toBeNull();
  });

  it("type=image 但 url 是视频后缀：仍渲染 <video>（兼容历史 image+视频url 节点）", () => {
    const { container } = render(
      <MediaStateBody type="image" imageUrl="https://tos/a.mp4" />
    );
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
