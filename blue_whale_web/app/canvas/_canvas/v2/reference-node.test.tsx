// @vitest-environment jsdom
/**
 * IK55VT 参考卡 ReferenceNode 测试（jsdom）。
 * seam = 外部可观察行为，三态模型（产品截图权威）：
 * ① 全新空卡 = 头部 + 居中栈（从画布拖入 + 静态不可编辑占位 + 添加/生成按钮 + ⓘ1张参考图），无可编辑文字；
 * ② 有参考图 = 头部 + 顶部描述编辑区 + 分隔线 + 大图（宽高比自适应）+ 悬停替换/删除 + character 音色区；
 * ③ 删图留史 = 顶部保留历史描述 + 干净居中栈。
 * chrome = 选中时顶部居中 @ 按钮（点击无行为，预留）；无「重新编辑」按钮。
 * Handle/NodeResizer/NodeToolbar mock 为 passthrough（脱离 RF store）。
 */
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";

vi.mock("@xyflow/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...mod,
    NodeResizer: () => null,
    Handle: () => null,
    NodeToolbar: ({
      children,
      isVisible,
    }: {
      children: ReactNode;
      isVisible?: boolean;
    }) => (isVisible === false ? null : createElement("div", {}, children)),
  };
});

import { ReferenceNode, NodeActionsContext } from "./nodes";
import {
  REFERENCE_CARD_HEIGHT,
  REFERENCE_CARD_TYPES,
  REFERENCE_PRODUCT_HEIGHT,
  REFERENCE_VOICE_SECTION_HEIGHT,
} from "../constants";
import { useCanvasStore } from "../store";
import type { ReferenceCardType } from "../model";

expect.extend(jestDomMatchers);

beforeEach(() => {
  useCanvasStore.setState({ assets: {} });
});
afterEach(() => cleanup());

type RenderOpts = {
  cardType: ReferenceCardType;
  name?: string;
  description?: string;
  referenceAssetId?: string;
  referenceImageAspect?: number;
  selected?: boolean;
  /** 模拟 RF v12 NodeProps.height 回读(getNodeDimensions:首测前 0,塌缩测量 2) */
  height?: number;
  onEditDescription?: (id: string, text: string) => void;
  onEditReferenceName?: (id: string, name: string) => void;
  onUploadReferenceImage?: (id: string) => void;
  onGenerateReferenceImage?: (id: string) => void;
  onRemoveReferenceImage?: (id: string) => void;
  referenceDropTargetId?: string | null;
};

function renderReferenceNode(opts: RenderOpts) {
  const props = {
    id: "r1",
    data: {
      kind: "reference",
      cardType: opts.cardType,
      ...(opts.name != null ? { name: opts.name } : {}),
      ...(opts.description != null ? { description: opts.description } : {}),
      ...(opts.referenceAssetId != null
        ? { referenceAssetId: opts.referenceAssetId }
        : {}),
      ...(opts.referenceImageAspect != null
        ? { referenceImageAspect: opts.referenceImageAspect }
        : {}),
    },
    selected: opts.selected ?? false,
    ...(opts.height != null ? { height: opts.height } : {}),
  } as unknown as NodeProps;
  return render(
    <NodeActionsContext.Provider
      value={{
        onEditDescription: opts.onEditDescription,
        onEditReferenceName: opts.onEditReferenceName,
        onUploadReferenceImage: opts.onUploadReferenceImage,
        onGenerateReferenceImage: opts.onGenerateReferenceImage,
        onRemoveReferenceImage: opts.onRemoveReferenceImage,
        referenceDropTargetId: opts.referenceDropTargetId ?? null,
      }}
    >
      <ReferenceNode {...props} />
    </NodeActionsContext.Provider>,
  );
}

/** 已填态：seed 参考图 asset 到 store。 */
function seedReferenceAsset(id = "77") {
  useCanvasStore.setState({
    assets: {
      [id]: { id, kind: "image", src: `https://cdn.example/${id}.png` },
    },
  });
  return id;
}

describe("ReferenceNode 空卡态（IK55VT：全新空卡无可编辑文字）", () => {
  it.each(
    REFERENCE_CARD_TYPES.map((t) => ({
      cardType: t.id,
      label: t.label,
      placeholder: t.placeholder,
    })),
  )(
    "$cardType：头部 @$label（默认卡名=类型名）+ 静态占位文案",
    ({ cardType, label, placeholder }) => {
      renderReferenceNode({ cardType });
      // selector 限定头部名(IK55VZ 商品卡 chrome 左上也有「商品」标签,防多匹配)
      expect(
        screen.getByText(label, { selector: "span.truncate" }),
      ).toBeInTheDocument();
      expect(screen.getByText(placeholder)).toBeInTheDocument();
    },
  );

  it("空态通用元素：从画布拖入 + 添加图片/生成图片按钮(可用) + 1 张参考图", () => {
    renderReferenceNode({ cardType: "style" });
    expect(screen.getByText("从画布拖入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加图片/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /生成图片/ })).toBeEnabled();
    expect(screen.getByText(/1 张参考图/)).toBeInTheDocument();
  });

  it("空卡占位文案静态不可编辑：双击不出现编辑框", () => {
    const onEditDescription = vi.fn();
    renderReferenceNode({ cardType: "style", onEditDescription });
    fireEvent.doubleClick(screen.getByText("描述视觉风格、配色与艺术方向…"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onEditDescription).not.toHaveBeenCalled();
  });

  it("「添加图片/生成图片」按钮触发对应通道回调", () => {
    const onUploadReferenceImage = vi.fn();
    const onGenerateReferenceImage = vi.fn();
    renderReferenceNode({
      cardType: "style",
      onUploadReferenceImage,
      onGenerateReferenceImage,
    });
    fireEvent.click(screen.getByRole("button", { name: /添加图片/ }));
    expect(onUploadReferenceImage).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: /生成图片/ }));
    expect(onGenerateReferenceImage).toHaveBeenCalledWith("r1");
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

  it("character 音色区含悬停展开内容（从画布拖入音频 + 上传音色音频，mock）", () => {
    renderReferenceNode({ cardType: "character" });
    expect(screen.getByText("从画布拖入音频")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /上传音色音频/ }),
    ).toBeInTheDocument();
  });

  it("无「重新编辑」按钮（工单明确不做）", () => {
    renderReferenceNode({ cardType: "style" });
    expect(screen.queryByText("重新编辑")).toBeNull();
  });

  // 回归:CanvasSurface 对 reference 节点剥离 height 后,RF v12 getNodeDimensions
  // 回读 0(首测前);若把该 prop 钉进内联样式,会形成 0→测得 2px→钉 2px 的
  // 自反馈塌缩环——空卡渲染成一条线(内容被 overflow-hidden 裁掉)。
  it.each([0, 2])(
    "RF 回读 height=%i 时空卡不塌缩：内联高度=默认卡高（不消费 measured 回读）",
    (h) => {
      renderReferenceNode({ cardType: "style", height: h });
      const root = document.querySelector(".tc-reference-node") as HTMLElement;
      expect(root.style.height).toBe(`${REFERENCE_CARD_HEIGHT}px`);
    },
  );

  it("character 空卡同理不塌缩：默认高=卡高+音色区", () => {
    renderReferenceNode({ cardType: "character", height: 0 });
    const root = document.querySelector(".tc-reference-node") as HTMLElement;
    expect(root.style.height).toBe(
      `${REFERENCE_CARD_HEIGHT + REFERENCE_VOICE_SECTION_HEIGHT}px`,
    );
  });

  it("商品卡 minHeight 不吃 RF 回读 0：仍兜底默认 560", () => {
    renderReferenceNode({ cardType: "product", height: 0 });
    const root = document.querySelector(".tc-reference-node") as HTMLElement;
    expect(root.style.minHeight).toBe(`${REFERENCE_PRODUCT_HEIGHT}px`);
  });
});

describe("ReferenceNode chrome（@ 按钮：选中才出现、点击无行为）", () => {
  it("选中时顶部浮出 @ 按钮；未选中不出现", () => {
    const { unmount } = renderReferenceNode({
      cardType: "style",
      selected: true,
    });
    expect(
      screen.getByRole("button", { name: "引用卡片" }),
    ).toBeInTheDocument();
    unmount();
    renderReferenceNode({ cardType: "style", selected: false });
    expect(screen.queryByRole("button", { name: "引用卡片" })).toBeNull();
  });

  it("@ 按钮点击无行为（预留，不报错不触发回调）", () => {
    renderReferenceNode({ cardType: "style", selected: true });
    fireEvent.click(screen.getByRole("button", { name: "引用卡片" }));
    // 无断言回调：能点、不炸即契约
  });
});

describe("ReferenceNode 卡名编辑", () => {
  it("双击卡名进入编辑，失焦 commit 写回 name", () => {
    const onEditReferenceName = vi.fn();
    renderReferenceNode({ cardType: "style", onEditReferenceName });
    fireEvent.doubleClick(screen.getByText("Style"));
    const input = screen.getByDisplayValue("Style");
    fireEvent.change(input, { target: { value: "Mythic Epic" } });
    fireEvent.blur(input);
    expect(onEditReferenceName).toHaveBeenCalledWith("r1", "Mythic Epic");
  });

  it("卡名编辑 Esc 取消：不 commit、退回展示态", () => {
    const onEditReferenceName = vi.fn();
    renderReferenceNode({ cardType: "style", onEditReferenceName });
    fireEvent.doubleClick(screen.getByText("Style"));
    const input = screen.getByDisplayValue("Style");
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onEditReferenceName).not.toHaveBeenCalled();
    expect(screen.getByText("Style")).toBeInTheDocument();
  });

  it("有 name 时显示自定义卡名而非类型名", () => {
    renderReferenceNode({ cardType: "character", name: "Zeus" });
    expect(screen.getByText("Zeus")).toBeInTheDocument();
    expect(screen.queryByText("Character")).toBeNull();
  });
});

describe("ReferenceNode 已填态（有参考图）", () => {
  it("大图按 assetId 渲染 + 描述区在顶部 + 无空态栈", () => {
    const assetId = seedReferenceAsset();
    renderReferenceNode({
      cardType: "character",
      name: "Zeus",
      referenceAssetId: assetId,
      referenceImageAspect: 1.5,
    });
    const img = screen.getByRole("img", { name: "Zeus" });
    expect(img).toHaveAttribute("src", "https://cdn.example/77.png");
    // 空态元素消失
    expect(screen.queryByText("从画布拖入")).toBeNull();
    expect(screen.queryByText(/1 张参考图/)).toBeNull();
    // 描述区在顶部（空描述显示占位，可编辑）
    expect(
      screen.getByText("描述外观、性格、角色弧光、语音风格…"),
    ).toBeInTheDocument();
  });

  it("描述区双击编辑，失焦 commit 写回 description", () => {
    const assetId = seedReferenceAsset();
    const onEditDescription = vi.fn();
    renderReferenceNode({
      cardType: "style",
      referenceAssetId: assetId,
      onEditDescription,
    });
    fireEvent.doubleClick(screen.getByText("描述视觉风格、配色与艺术方向…"));
    const textarea =
      screen.getByPlaceholderText("描述视觉风格、配色与艺术方向…");
    fireEvent.change(textarea, { target: { value: "赛博朋克霓虹" } });
    fireEvent.blur(textarea);
    expect(onEditDescription).toHaveBeenCalledWith("r1", "赛博朋克霓虹");
  });

  it("已有 description 时显示内容而非占位文案", () => {
    const assetId = seedReferenceAsset();
    renderReferenceNode({
      cardType: "style",
      referenceAssetId: assetId,
      description: "Hyper-realistic cinematic photoreal.",
    });
    expect(
      screen.getByText("Hyper-realistic cinematic photoreal."),
    ).toBeInTheDocument();
    expect(screen.queryByText("描述视觉风格、配色与艺术方向…")).toBeNull();
  });

  it("删除按钮触发 onRemoveReferenceImage；替换菜单含添加图片/生成图片", () => {
    const assetId = seedReferenceAsset();
    const onRemoveReferenceImage = vi.fn();
    const onUploadReferenceImage = vi.fn();
    const onGenerateReferenceImage = vi.fn();
    renderReferenceNode({
      cardType: "style",
      referenceAssetId: assetId,
      onRemoveReferenceImage,
      onUploadReferenceImage,
      onGenerateReferenceImage,
    });
    fireEvent.click(screen.getByRole("button", { name: "删除参考图" }));
    expect(onRemoveReferenceImage).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: "替换参考图" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /添加图片/ }));
    expect(onUploadReferenceImage).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: "替换参考图" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /生成图片/ }));
    expect(onGenerateReferenceImage).toHaveBeenCalledWith("r1");
  });

  it("已填态无「重新编辑」按钮", () => {
    const assetId = seedReferenceAsset();
    renderReferenceNode({ cardType: "style", referenceAssetId: assetId });
    expect(screen.queryByText("重新编辑")).toBeNull();
  });
});

describe("ReferenceNode 删图留史态（描述保留、栈干净）", () => {
  it("有描述无图：描述在顶部可编辑，栈内无占位文案", () => {
    const onEditDescription = vi.fn();
    renderReferenceNode({
      cardType: "style",
      description: "历史描述保留",
      onEditDescription,
    });
    expect(screen.getByText("历史描述保留")).toBeInTheDocument();
    expect(screen.queryByText("描述视觉风格、配色与艺术方向…")).toBeNull();
    expect(screen.getByText("从画布拖入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加图片/ })).toBeEnabled();
    // 描述仍可编辑
    fireEvent.doubleClick(screen.getByText("历史描述保留"));
    const textarea = screen.getByDisplayValue("历史描述保留");
    fireEvent.blur(textarea);
  });
});

describe("ReferenceNode 画布拖入高亮", () => {
  it("referenceDropTargetId 命中本卡 → accent 描边高亮；未命中无", () => {
    const { container, unmount } = renderReferenceNode({
      cardType: "style",
      referenceDropTargetId: "r1",
    });
    expect(container.querySelector(".tc-reference-node")).toHaveStyle({
      outline: "2px solid var(--tc-accent)",
    });
    unmount();
    const { container: c2 } = renderReferenceNode({
      cardType: "style",
      referenceDropTargetId: "other",
    });
    expect(c2.querySelector(".tc-reference-node")).not.toHaveStyle({
      outline: "2px solid var(--tc-accent)",
    });
  });
});
