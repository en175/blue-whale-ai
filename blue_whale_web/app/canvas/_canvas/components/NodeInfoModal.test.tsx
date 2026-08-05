// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NodeInfoModal } from "./NodeInfoModal";

describe("NodeInfoModal（IK6M68）", () => {
  afterEach(() => cleanup());

  it("渲染节点元数据：类型/名称/尺寸/时长/资产ID/状态/来源", () => {
    render(
      <NodeInfoModal
        node={{
          id: "n1",
          type: "image",
          position: { x: 0, y: 0 },
          width: 1024,
          height: 768,
          data: {
            kind: "image",
            name: "示例图",
            assetId: "42",
            status: "done",
            recipe: { origin: "generated" },
          },
        }}
        asset={{
          id: "42",
          kind: "image",
          width: 1024,
          height: 768,
          duration: 3,
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "节点信息 示例图" }),
    ).toBeInTheDocument();
    expect(screen.getByText("图片")).toBeInTheDocument();
    expect(screen.getByText("示例图")).toBeInTheDocument();
    expect(screen.getByText("1024 × 768")).toBeInTheDocument();
    expect(screen.getByText("3秒")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("AI 生成")).toBeInTheDocument();
  });

  it("未知 kind 展示原始值；关闭按钮与点遮罩均触发 onClose", () => {
    const onClose = vi.fn();
    render(
      <NodeInfoModal
        node={{
          id: "n2",
          type: "text",
          position: { x: 0, y: 0 },
          data: { kind: "text", content: "一段文本" },
        }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("文本")).toBeInTheDocument();
    expect(screen.getByText("一段文本")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // 点遮罩（dialog 本身）关闭
    fireEvent.click(screen.getByRole("dialog", { name: "节点信息 一段文本" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
