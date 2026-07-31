// @vitest-environment jsdom
/**
 * IK55VZ 商品卡 ReferenceNode(isProduct 分支)测试(jsdom)。
 * seam = 外部可观察行为(原型两张截图定稿):
 * ① 空态 = 头部(28px @ chip + 大号粗体名,双击编辑)+ 图片区(虚线框/「已启用 0/8」)
 *    + 详情区(占位)+ 链接导入区(默认展开);不渲染单图槽/三按钮空态/替换菜单;
 * ② 已填 = 图块横排(n/8,+ 槽 n<8 显/n=8 隐)+ 详情 + 链接区;
 * chrome:沿用参考卡 NodeToolbar @ 按钮;链接导入走 onImportProductLink 回调
 * (harness 用 productImportPatch 模拟 runtime 填充,验证回填渲染与命名保护)。
 * Handle/NodeResizer/NodeToolbar mock 为 passthrough(脱离 RF store)。
 */
import { createElement, useState, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
import { useCanvasStore } from "../store";
import { parseProductUrl, productImportPatch } from "../productImport";
import type { CanvasNodeData } from "../model";

expect.extend(jestDomMatchers);

beforeEach(() => {
  useCanvasStore.setState({ assets: {} });
});
afterEach(() => cleanup());

type RenderOpts = {
  name?: string;
  detail?: string;
  imageAssetIds?: string[];
  sourceUrl?: string;
  selected?: boolean;
  onEditReferenceName?: (id: string, name: string) => void;
  onEditProductDetail?: (id: string, text: string) => void;
  onUploadReferenceImage?: (id: string) => void;
  onRemoveProductImage?: (id: string, assetId: string) => void;
  onImportProductLink?: (id: string, url: string) => void;
};

function renderProductNode(opts: RenderOpts) {
  const props = {
    id: "p1",
    data: {
      kind: "reference",
      cardType: "product",
      ...(opts.name != null ? { name: opts.name } : {}),
      ...(opts.detail != null ? { detail: opts.detail } : {}),
      ...(opts.imageAssetIds != null
        ? { imageAssetIds: opts.imageAssetIds }
        : {}),
      ...(opts.sourceUrl != null ? { sourceUrl: opts.sourceUrl } : {}),
    },
    selected: opts.selected ?? false,
  } as unknown as NodeProps;
  return render(
    <NodeActionsContext.Provider
      value={{
        onEditReferenceName: opts.onEditReferenceName,
        onEditProductDetail: opts.onEditProductDetail,
        onUploadReferenceImage: opts.onUploadReferenceImage,
        onRemoveProductImage: opts.onRemoveProductImage,
        onImportProductLink: opts.onImportProductLink,
      }}
    >
      <ReferenceNode {...props} />
    </NodeActionsContext.Provider>,
  );
}

/** seed 商品图 assets 到 store。 */
function seedProductAssets(ids: string[]) {
  useCanvasStore.setState({
    assets: Object.fromEntries(
      ids.map((id) => [
        id,
        { id, kind: "image" as const, src: `https://cdn.example/${id}.png` },
      ]),
    ),
  });
}

describe("ReferenceNode 商品卡空态(原型截图一)", () => {
  it("头部名称 + 图片区「已启用 0/8」虚线框 + 详情占位 + 链接导入区默认展开", () => {
    renderProductNode({ name: "商品 1" });
    expect(screen.getByText("商品 1")).toBeInTheDocument();
    expect(screen.getByText("商品图片")).toBeInTheDocument();
    expect(screen.getByText("已启用 0/8")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /拖入或点击添加商品图/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("商品详情")).toBeInTheDocument();
    expect(
      screen.getByText("商品名称、品类、核心参数、卖点、目标人群…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /从商品链接导入/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("无 name 时默认显示类型名「商品」(头部名,非 chrome 标签)", () => {
    renderProductNode({});
    expect(
      screen.getByText("商品", { selector: "span.truncate" }),
    ).toBeInTheDocument();
  });

  it("不渲染单图参考卡元素:三按钮空态/「1 张参考图」/「从画布拖入」", () => {
    renderProductNode({ name: "商品 1" });
    expect(screen.queryByText("从画布拖入")).toBeNull();
    expect(screen.queryByText(/1 张参考图/)).toBeNull();
    expect(screen.queryByRole("button", { name: /生成图片/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "替换参考图" })).toBeNull();
  });

  it("空态虚线框点击走上传通道(onUploadReferenceImage,runtime 追加语义)", () => {
    const onUploadReferenceImage = vi.fn();
    renderProductNode({ name: "商品 1", onUploadReferenceImage });
    fireEvent.click(
      screen.getByRole("button", { name: /拖入或点击添加商品图/ }),
    );
    expect(onUploadReferenceImage).toHaveBeenCalledWith("p1");
  });
});

describe("ReferenceNode 商品卡 chrome(原型定稿:选中或悬停浮出)", () => {
  const getChrome = () => screen.getByTestId("product-chrome");

  it("未选中未悬停:chrome 层不可见(opacity 0);选中 → 浮出「商品」标签 + 「@ 添加到对话」胶囊", () => {
    const { unmount } = renderProductNode({ name: "商品 1" });
    expect(getChrome().style.opacity).toBe("0");
    unmount();
    renderProductNode({ name: "商品 1", selected: true });
    expect(getChrome().style.opacity).toBe("1");
    // 左上「商品」标签(Package 图标 + 文字)
    expect(within(getChrome()).getByText("商品")).toBeInTheDocument();
    // 居中深色胶囊「@ 添加到对话」(@ 仅预留,点击无行为)
    const pill = within(getChrome()).getByRole("button", {
      name: /添加到对话/,
    });
    fireEvent.click(pill); // 能点、不炸即契约
  });

  it("悬停卡面 → chrome 浮出;移出 → 收回", () => {
    const { container } = renderProductNode({ name: "商品 1" });
    const card = container.querySelector(".tc-reference-node")!;
    fireEvent.pointerEnter(card);
    expect(getChrome().style.opacity).toBe("1");
    fireEvent.pointerLeave(card);
    expect(getChrome().style.opacity).toBe("0");
  });

  it("商品卡不再渲染参考卡裸 @ 圆钮(「引用卡片」)", () => {
    renderProductNode({ name: "商品 1", selected: true });
    expect(screen.queryByRole("button", { name: "引用卡片" })).toBeNull();
  });
});

describe("ReferenceNode 商品卡名称编辑", () => {
  it("双击卡名编辑,失焦 commit onEditReferenceName;Esc 取消", () => {
    const onEditReferenceName = vi.fn();
    renderProductNode({ name: "商品 1", onEditReferenceName });
    fireEvent.doubleClick(screen.getByText("商品 1"));
    const input = screen.getByDisplayValue("商品 1");
    fireEvent.change(input, { target: { value: "户外蓝牙音箱" } });
    fireEvent.blur(input);
    expect(onEditReferenceName).toHaveBeenCalledWith("p1", "户外蓝牙音箱");
  });
});

describe("ReferenceNode 商品卡已填态(原型截图二)", () => {
  it("3 张图:计数 3/8、图块渲染 asset src、尾部「+」槽显示", () => {
    seedProductAssets(["i1", "i2", "i3"]);
    renderProductNode({
      name: "商品 1",
      imageAssetIds: ["i1", "i2", "i3"],
    });
    expect(screen.getByText("已启用 3/8")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "主图" })).toHaveAttribute(
      "src",
      "https://cdn.example/i1.png",
    );
    expect(
      screen.getByRole("button", { name: "添加商品图" }),
    ).toBeInTheDocument();
  });

  it("满 8 张:「+」槽隐藏", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `i${i + 1}`);
    seedProductAssets(ids);
    renderProductNode({ name: "商品 1", imageAssetIds: ids });
    expect(screen.getByText("已启用 8/8")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加商品图" })).toBeNull();
  });

  it("移除图片回调带 assetId;详情双击编辑 commit onEditProductDetail", () => {
    seedProductAssets(["i1", "i2"]);
    const onRemoveProductImage = vi.fn();
    const onEditProductDetail = vi.fn();
    renderProductNode({
      name: "商品 1",
      imageAssetIds: ["i1", "i2"],
      detail: "已有详情",
      onRemoveProductImage,
      onEditProductDetail,
    });
    fireEvent.click(screen.getAllByRole("button", { name: "移除图片" })[0]);
    expect(onRemoveProductImage).toHaveBeenCalledWith("p1", "i1");
    fireEvent.doubleClick(screen.getByText("已有详情"));
    const textarea = screen.getByDisplayValue("已有详情");
    fireEvent.change(textarea, { target: { value: "新详情" } });
    fireEvent.blur(textarea);
    expect(onEditProductDetail).toHaveBeenCalledWith("p1", "新详情");
  });

  it("sourceUrl 回填链接输入框", () => {
    renderProductNode({
      name: "商品 1",
      sourceUrl: "https://example.com/item/42",
    });
    expect(screen.getByLabelText("商品链接")).toHaveValue(
      "https://example.com/item/42",
    );
  });
});

/** stateful harness:用 productImportPatch 模拟 runtime 链接导入填充(与生产同一纯函数)。 */
function ImportHarness({ initialName }: { initialName: string }) {
  const [data, setData] = useState<CanvasNodeData>({
    kind: "reference",
    cardType: "product",
    name: initialName,
    detail: "",
    imageAssetIds: [],
  });
  const onImportProductLink = (_id: string, url: string) => {
    const parsed = parseProductUrl(url);
    const newIds = parsed.images.map((src, i) => {
      const aid = `imp-${i}`;
      useCanvasStore.setState((s) => ({
        assets: {
          ...s.assets,
          [aid]: { id: aid, kind: "image" as const, src },
        },
      }));
      return aid;
    });
    setData((d) => ({ ...d, ...productImportPatch(d, parsed, url, newIds) }));
  };
  const props = { id: "p1", data, selected: false } as unknown as NodeProps;
  return (
    <NodeActionsContext.Provider value={{ onImportProductLink }}>
      <ReferenceNode {...props} />
    </NodeActionsContext.Provider>
  );
}

describe("ReferenceNode 商品卡链接导入(mock 填充)", () => {
  it("点「导入」回调 (id, url);填充后详情与 4 张图渲染,自动编号名被解析名替换", () => {
    render(<ImportHarness initialName="商品 1" />);
    fireEvent.change(screen.getByLabelText("商品链接"), {
      target: { value: "https://example.com/item/42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    // 填充:4 张图 + 详情 + 名称采用解析名(原「商品 1」是自动编号)
    expect(screen.getByText("已启用 4/8")).toBeInTheDocument();
    expect(screen.getByText(/品类:便携蓝牙音箱|品类:/)).toBeInTheDocument();
    expect(screen.getByText("导入商品 · example.com")).toBeInTheDocument();
  });

  it("用户已改名 → 导入后名称不被覆盖", () => {
    render(<ImportHarness initialName="户外蓝牙音箱" />);
    fireEvent.change(screen.getByLabelText("商品链接"), {
      target: { value: "https://example.com/item/42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(screen.getByText("户外蓝牙音箱")).toBeInTheDocument();
    expect(screen.queryByText("导入商品 · example.com")).toBeNull();
  });
});
