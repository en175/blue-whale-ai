// @vitest-environment jsdom
/**
 * IK55VH 富文本卡三态状态机测试（jsdom + 真 TipTap 编辑器）。
 * seam = 外部可观察行为：工具栏浮出/编辑器可输入性/失焦 commit 回调/占位文案/展开模态。
 * NodeToolbar/NodeResizer/Handle 部分 mock 为 passthrough（脱离 RF store），其余真实 import。
 */
import { createElement, type ReactNode } from "react";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";

vi.mock("@xyflow/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...mod,
    NodeToolbar: ({
      children,
      isVisible,
    }: {
      children: ReactNode;
      isVisible?: boolean;
    }) =>
      isVisible
        ? createElement("div", { "data-testid": "tc-node-toolbar" }, children)
        : null,
    NodeResizer: () => null,
    Handle: () => null,
  };
});

import { TextNode, NodeActionsContext } from "../nodes";
import { filterMentionItems } from "./RichTextEditor";
import type { TextMentionItem } from "./types";

beforeAll(() => {
  // jsdom 无布局：补 ProseMirror 依赖的测量/滚动 API
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  document.elementFromPoint = () => null;
});

afterEach(() => {
  cleanup();
});

function renderTextNode(opts: {
  data?: Record<string, unknown>;
  selected?: boolean;
  onEditRichText?: (id: string, richDoc: unknown, plainText: string) => void;
  mentionItems?: TextMentionItem[];
}) {
  const props = {
    id: "t1",
    type: "text",
    data: { kind: "text", ...(opts.data ?? {}) },
    width: 200,
    height: 48,
    selected: opts.selected ?? false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    zIndex: 0,
    isConnectable: false,
  } as unknown as NodeProps;
  return render(
    <NodeActionsContext.Provider
      value={{
        onEditRichText: opts.onEditRichText,
        mentionItems: opts.mentionItems,
      }}
    >
      <TextNode {...props} />
    </NodeActionsContext.Provider>,
  );
}

const richEditor = (c: HTMLElement) =>
  c.querySelector<HTMLElement>(".tc-rich-editor");

describe("TextNode 三态状态机", () => {
  it("未选中（idle）：只读渲染旧卡纯文本（无 richDoc 时以 prompt 播种），无工具栏", async () => {
    const { container } = renderTextNode({ data: { prompt: "画一只猫" } });
    await waitFor(() => expect(richEditor(container)).not.toBeNull());
    expect(richEditor(container)?.textContent).toContain("画一只猫");
    expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
      "false",
    );
    expect(screen.queryByTestId("tc-node-toolbar")).toBeNull();
  });

  it("选中（selected）：浮出工具栏但编辑器不可输入（选中≠编辑）", async () => {
    const { container } = renderTextNode({
      data: { prompt: "画一只猫" },
      selected: true,
    });
    await waitFor(() => expect(richEditor(container)).not.toBeNull());
    expect(screen.getByTestId("tc-node-toolbar")).toBeInTheDocument();
    expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
      "false",
    );
  });

  it("双击进入编辑：编辑器变为可输入", async () => {
    const { container } = renderTextNode({
      data: { prompt: "画一只猫" },
      selected: true,
    });
    await waitFor(() => expect(richEditor(container)).not.toBeNull());
    fireEvent.doubleClick(container.querySelector(".tc-text-node")!);
    await waitFor(() =>
      expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
        "true",
      ),
    );
  });

  it("只读态整卡可拖（IK5U3K）：内容区与编辑器根不带 nodrag；编辑态才附加", async () => {
    const { container } = renderTextNode({
      data: { prompt: "画一只猫" },
      selected: true,
    });
    await waitFor(() => expect(richEditor(container)).not.toBeNull());
    const contentArea = container.querySelector<HTMLElement>(
      ".tc-text-node > div",
    );
    expect(contentArea?.className).not.toContain("nodrag");
    expect(richEditor(container)?.className).not.toContain("nodrag");
    // 进编辑态：nodrag 附加（文本选区不触发卡片拖拽）
    fireEvent.doubleClick(container.querySelector(".tc-text-node")!);
    await waitFor(() =>
      expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
        "true",
      ),
    );
    expect(contentArea?.className).toContain("nodrag");
    expect(richEditor(container)?.className).toContain("nodrag");
  });

  it("编辑态失焦：commit 回调带 richDoc(JSON doc) + 派生纯文本", async () => {
    const onEditRichText = vi.fn();
    const { container } = renderTextNode({
      data: { prompt: "画一只猫" },
      selected: true,
      onEditRichText,
    });
    await waitFor(() => expect(richEditor(container)).not.toBeNull());
    fireEvent.doubleClick(container.querySelector(".tc-text-node")!);
    await waitFor(() =>
      expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
        "true",
      ),
    );
    fireEvent.blur(richEditor(container)!);
    await waitFor(() => expect(onEditRichText).toHaveBeenCalled());
    const [id, richDoc, plainText] = onEditRichText.mock.calls[0];
    expect(id).toBe("t1");
    expect((richDoc as { type?: string }).type).toBe("doc");
    expect(plainText).toBe("画一只猫");
    // commit 后回退：编辑器不可输入
    await waitFor(() =>
      expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
        "false",
      ),
    );
  });

  it("空卡占位「添加笔记...」，失焦后空卡保留（commit 空串，无删除）", async () => {
    const onEditRichText = vi.fn();
    const { container } = renderTextNode({
      selected: true,
      onEditRichText,
    });
    expect(screen.getByText("添加笔记...")).toBeInTheDocument();
    expect(richEditor(container)).toBeNull(); // 空卡 idle 不渲染编辑器
    fireEvent.doubleClick(container.querySelector(".tc-text-node")!);
    await waitFor(() =>
      expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
        "true",
      ),
    );
    fireEvent.blur(richEditor(container)!);
    await waitFor(() => expect(onEditRichText).toHaveBeenCalled());
    const [id, , plainText] = onEditRichText.mock.calls[0];
    expect(id).toBe("t1");
    expect(plainText).toBe("");
    // 空卡保留：回展示态后仍是占位卡，未被移除
    await waitFor(() =>
      expect(screen.getByText("添加笔记...")).toBeInTheDocument(),
    );
  });

  it("选中态点工具栏命令：立即写回（加粗落进 richDoc），不进编辑态", async () => {
    const onEditRichText = vi.fn();
    const { container } = renderTextNode({
      data: { prompt: "画一只猫" },
      selected: true,
      onEditRichText,
    });
    await waitFor(() => expect(richEditor(container)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "加粗" }));
    await waitFor(() => expect(onEditRichText).toHaveBeenCalled());
    const [id, richDoc, plainText] = onEditRichText.mock.calls[0];
    expect(id).toBe("t1");
    // bold mark 落进 doc（选中态命令 selectAll 作用于全文）
    const para = (
      richDoc as {
        content?: Array<{
          content?: Array<{ marks?: Array<{ type: string }>; text?: string }>;
        }>;
      }
    ).content?.[0]?.content?.[0];
    expect(para?.text).toBe("画一只猫");
    expect(para?.marks).toContainEqual({ type: "bold" });
    expect(plainText).toBe("画一只猫");
    // 状态不变：未进编辑态、未展开
    expect(richEditor(container)?.getAttribute("contenteditable")).toBe(
      "false",
    );
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  });

  it("展开态编辑器失焦：模态不塌缩（仍由 X 关闭并 commit）", async () => {
    const onEditRichText = vi.fn();
    const { container } = renderTextNode({
      data: { prompt: "画一只猫" },
      selected: true,
      onEditRichText,
    });
    await waitFor(() =>
      expect(screen.getByTestId("tc-node-toolbar")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "展开大编辑视图" }));
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    // 模态内失焦（如点到标题栏空隙）：不 commit、不关闭
    fireEvent.blur(richEditor(container)!);
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(onEditRichText).not.toHaveBeenCalled();
    // X 关闭才 commit
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(onEditRichText).toHaveBeenCalled());
    expect(onEditRichText).toHaveBeenCalledTimes(1);
  });

  it("工具栏按钮全集渲染（颜色/P-H3/B/I/U/S/两列表/引用/分割线/清除/@/展开）", async () => {
    renderTextNode({ data: { prompt: "x" }, selected: true });
    await waitFor(() =>
      expect(screen.getByTestId("tc-node-toolbar")).toBeInTheDocument(),
    );
    for (const label of [
      "文本颜色",
      "段落级别 P",
      "段落级别 H1",
      "段落级别 H2",
      "段落级别 H3",
      "加粗",
      "斜体",
      "下划线",
      "删除线",
      "无序列表",
      "有序列表",
      "引用",
      "分割线",
      "清除格式",
      "@ 引用画布素材",
      "展开大编辑视图",
    ]) {
      expect(
        screen.getByRole("button", { name: label }),
        `缺按钮: ${label}`,
      ).toBeInTheDocument();
    }
  });

  it("展开大编辑视图：开/关模态（关闭即 commit 回展示态）", async () => {
    const onEditRichText = vi.fn();
    renderTextNode({
      data: { prompt: "画一只猫" },
      selected: true,
      onEditRichText,
    });
    await waitFor(() =>
      expect(screen.getByTestId("tc-node-toolbar")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "展开大编辑视图" }));
    // 模态打开：有关闭按钮，卡片工具栏收起
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(screen.queryByTestId("tc-node-toolbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "关闭" }),
      ).not.toBeInTheDocument(),
    );
    expect(onEditRichText).toHaveBeenCalled();
  });
});

describe("filterMentionItems（@ 建议过滤）", () => {
  const items: TextMentionItem[] = [
    { id: "1", type: "image", name: "产品主图.png" },
    { id: "2", type: "video", name: "宣传片头.mp4" },
    { id: "3", type: "audio", name: "背景音乐.mp3" },
  ];

  it("名称子串匹配（大小写不敏感）", () => {
    expect(filterMentionItems(items, "产品")).toEqual([items[0]]);
    expect(filterMentionItems(items, "MP4")).toEqual([items[1]]);
    expect(filterMentionItems(items, "")).toEqual(items);
    expect(filterMentionItems(items, "不存在")).toEqual([]);
  });

  it("上限 8 条", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      type: "image" as const,
      name: `素材${i}`,
    }));
    expect(filterMentionItems(many, "素材")).toHaveLength(8);
  });
});
