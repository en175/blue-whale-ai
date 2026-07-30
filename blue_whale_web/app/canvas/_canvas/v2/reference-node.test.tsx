// @vitest-environment jsdom
/**
 * IK55VS 参考卡 ReferenceNode 测试（jsdom）。
 * seam = 外部可观察行为：五类空卡形态（头部 @+英文名/占位文案/空态元素）、
 * character 独有音色区、描述行双击就地编辑失焦 commit。
 * 卡片形态以产品截图为权威（IK54R3）；Handle/NodeResizer mock 为 passthrough（脱离 RF store）。
 */
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";

vi.mock("@xyflow/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...mod,
    NodeResizer: () => null,
    Handle: () => null,
    NodeToolbar: ({ children }: { children: ReactNode }) =>
      createElement("div", {}, children),
  };
});

import { ReferenceNode, NodeActionsContext } from "./nodes";
import { REFERENCE_CARD_TYPES } from "../constants";
import type { ReferenceCardType } from "../model";

expect.extend(jestDomMatchers);

afterEach(() => cleanup());

function renderReferenceNode(opts: {
  cardType: ReferenceCardType;
  description?: string;
  selected?: boolean;
  onEditDescription?: (id: string, text: string) => void;
}) {
  const props = {
    id: "r1",
    data: {
      kind: "reference",
      cardType: opts.cardType,
      ...(opts.description != null ? { description: opts.description } : {}),
    },
    selected: opts.selected ?? false,
  } as unknown as NodeProps;
  return render(
    <NodeActionsContext.Provider
      value={{ onEditDescription: opts.onEditDescription }}
    >
      <ReferenceNode {...props} />
    </NodeActionsContext.Provider>,
  );
}

describe("ReferenceNode（IK55VS 参考卡空卡形态，截图权威）", () => {
  it.each(
    REFERENCE_CARD_TYPES.map((t) => ({
      cardType: t.id,
      label: t.label,
      placeholder: t.placeholder,
    })),
  )(
    "$cardType：头部 @$label + 按类型占位文案",
    ({ cardType, label, placeholder }) => {
      renderReferenceNode({ cardType });
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(placeholder)).toBeInTheDocument();
    },
  );

  it("空态通用元素：从画布拖入 + 添加图片/生成图片按钮(置灰呈现) + 1 张参考图", () => {
    renderReferenceNode({ cardType: "style" });
    expect(screen.getByText("从画布拖入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加图片/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /生成图片/ })).toBeDisabled();
    expect(screen.getByText(/1 张参考图/)).toBeInTheDocument();
  });

  it("character 独有「设置角色音色」区（mock 占位）；其余卡类不显示", () => {
    const { unmount } = renderReferenceNode({ cardType: "character" });
    expect(screen.getByText("音色")).toBeInTheDocument();
    expect(screen.getByText("设置角色音色")).toBeInTheDocument();
    unmount();
    for (const t of ["style", "object", "environment", "custom"] as const) {
      const { unmount: u } = renderReferenceNode({ cardType: t });
      expect(screen.queryByText("设置角色音色")).toBeNull();
      u();
    }
  });

  it("描述行双击进入就地编辑，失焦 commit 写回 description", () => {
    const onEditDescription = vi.fn();
    renderReferenceNode({ cardType: "style", onEditDescription });
    fireEvent.doubleClick(screen.getByText("描述视觉风格、配色与艺术方向…"));
    const textarea =
      screen.getByPlaceholderText("描述视觉风格、配色与艺术方向…");
    fireEvent.change(textarea, { target: { value: "赛博朋克霓虹" } });
    fireEvent.blur(textarea);
    expect(onEditDescription).toHaveBeenCalledWith("r1", "赛博朋克霓虹");
  });

  it("编辑中 Esc 取消：不 commit、退回展示态", () => {
    const onEditDescription = vi.fn();
    renderReferenceNode({ cardType: "style", onEditDescription });
    fireEvent.doubleClick(screen.getByText("描述视觉风格、配色与艺术方向…"));
    const textarea =
      screen.getByPlaceholderText("描述视觉风格、配色与艺术方向…");
    fireEvent.change(textarea, { target: { value: "赛博朋克霓虹" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    fireEvent.blur(textarea);
    expect(onEditDescription).not.toHaveBeenCalled();
    expect(
      screen.getByText("描述视觉风格、配色与艺术方向…"),
    ).toBeInTheDocument();
  });

  it("已有 description 时显示内容而非占位文案", () => {
    renderReferenceNode({ cardType: "object", description: "哑光金属圆罐" });
    expect(screen.getByText("哑光金属圆罐")).toBeInTheDocument();
    expect(screen.queryByText("描述形状、材质与颜色…")).toBeNull();
  });
});
