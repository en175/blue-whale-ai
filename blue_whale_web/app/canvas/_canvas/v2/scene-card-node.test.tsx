// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";

vi.mock("@xyflow/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...mod,
    NodeToolbar: ({ children }: { children: ReactNode }) =>
      createElement("div", {}, children),
  };
});

vi.mock("./node-shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./node-shared")>();
  return { ...mod, NodeHandles: () => null };
});

import { NodeActionsContext } from "./node-shared";
import { SceneCardNode } from "./scene-card-node";

describe("SceneCardNode", () => {
  it("有效场景卡的删除按钮走资源删除回调", () => {
    const onDeleteSceneCard = vi.fn().mockResolvedValue(true);
    const onRemoveNode = vi.fn();
    const props = {
      id: "scene-card:7",
      selected: true,
      data: { kind: "scene_card", sceneCardId: "7" },
    } as unknown as NodeProps;

    render(
      <NodeActionsContext.Provider
        value={{
          onDeleteSceneCard,
          onRemoveNode,
          sceneCards: [
            {
              scene_card_id: "7",
              title: "场景七",
              summary: null,
              content_markdown: "# 正文",
              version: 1,
            },
          ],
        }}
      >
        <SceneCardNode {...props} />
      </NodeActionsContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "删除场景卡" }));
    expect(onDeleteSceneCard).toHaveBeenCalledWith("scene-card:7", "7");
    expect(onRemoveNode).not.toHaveBeenCalled();
  });

  it("生成流程后置时不暴露可点击但无动作的入口", () => {
    const props = {
      id: "scene-card:7",
      selected: false,
      data: { kind: "scene_card", sceneCardId: "7" },
    } as unknown as NodeProps;

    render(
      <NodeActionsContext.Provider
        value={{
          sceneCards: [
            {
              scene_card_id: "7",
              title: "场景七",
              summary: null,
              content_markdown: "# 可见正文",
              version: 1,
            },
          ],
        }}
      >
        <SceneCardNode {...props} />
      </NodeActionsContext.Provider>,
    );

    expect(screen.getByText("可见正文")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成视频" })).toBeNull();
    expect(screen.queryByRole("button", { name: "更多生成方式" })).toBeNull();
  });

  it("重复引用即使能查到正文也显示不可用态", () => {
    const props = {
      id: "scene-card:7:duplicate:1",
      selected: false,
      data: {
        kind: "scene_card",
        sceneCardId: "7",
        unavailableReason: "duplicate",
      },
    } as unknown as NodeProps;

    render(
      <NodeActionsContext.Provider
        value={{
          sceneCards: [
            {
              scene_card_id: "7",
              title: "场景七",
              summary: null,
              content_markdown: "# 不应显示的正文",
              version: 1,
            },
          ],
        }}
      >
        <SceneCardNode {...props} />
      </NodeActionsContext.Provider>,
    );

    expect(screen.getByText("场景卡不可用")).toBeInTheDocument();
    expect(screen.queryByText("不应显示的正文")).toBeNull();
  });
});
