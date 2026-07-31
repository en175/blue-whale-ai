// @vitest-environment jsdom
/**
 * IK5MC9 组件集成测试：菜单点击 → saveToSharedAssets → toast 反馈。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "@/components/Toast";
import { resetCardLibrary, listCardLibrary } from "../cardLibrary";
import { NodeContextMenu } from "./NodeContextMenu";
import type { CanvasNode, CanvasNodeData } from "../model";

expect.extend(jestDomMatchers);
afterEach(() => cleanup());
beforeEach(() => {
  resetCardLibrary();
  vi.clearAllMocks();
});

function makeNode(
  kind: string,
  data: Partial<CanvasNodeData> = {},
): CanvasNode {
  return {
    id: crypto.randomUUID(),
    type: kind as CanvasNode["type"],
    position: { x: 0, y: 0 },
    data: { kind: kind as CanvasNodeData["kind"], ...data },
  };
}

describe("IK5MC9 保存到共享资产 组件集成", () => {
  it("分组节点右键不渲染「保存到共享资产」菜单项", () => {
    render(
      <NodeContextMenu
        screenX={100}
        screenY={100}
        hideSaveToAssets
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("保存到共享资产")).not.toBeInTheDocument();
  });

  it("非分组节点右键渲染「保存到共享资产」菜单项", () => {
    render(
      <NodeContextMenu
        screenX={100}
        screenY={100}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("保存到共享资产")).toBeInTheDocument();
  });

  it("点击「保存到共享资产」触发 save-to-assets action 并 toast 成功", async () => {
    const { saveToSharedAssets } = await import("../cardLibrary");
    const nodes = [makeNode("image", { assetId: "a1" })];

    const onAction = vi.fn((action: string) => {
      if (action === "save-to-assets") {
        const count = saveToSharedAssets(nodes);
        if (count > 0) {
          toast.success(
            count === 1 ? "已保存到共享资产" : `已保存 ${count} 项到共享资产`,
          );
        }
      }
    });

    render(
      <NodeContextMenu
        screenX={100}
        screenY={100}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("保存到共享资产"));

    expect(onAction).toHaveBeenCalledWith("save-to-assets");
    expect(toast.success).toHaveBeenCalledWith("已保存到共享资产");
    expect(listCardLibrary({ cardType: "image" })).toHaveLength(1);
  });

  it("批量保存 toast 显示实际数量", async () => {
    const { saveToSharedAssets } = await import("../cardLibrary");
    const nodes = [
      makeNode("image", { assetId: "a1" }),
      makeNode("video", { assetId: "v1" }),
      makeNode("group"),
    ];

    const onAction = vi.fn((action: string) => {
      if (action === "save-to-assets") {
        const count = saveToSharedAssets(nodes);
        if (count > 0) {
          toast.success(
            count === 1 ? "已保存到共享资产" : `已保存 ${count} 项到共享资产`,
          );
        }
      }
    });

    render(
      <NodeContextMenu
        screenX={100}
        screenY={100}
        onAction={onAction}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("保存到共享资产"));

    expect(toast.success).toHaveBeenCalledWith("已保存 2 项到共享资产");
  });
});
