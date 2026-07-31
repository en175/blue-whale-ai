// @vitest-environment jsdom
/**
 * IK55VZ 商品卡专属区块组件测试(jsdom)。
 * seam = 外部可观察行为(原型 app/prototype/product-card 两张截图定稿):
 * 图片区(空态 150px 虚线框 / 已填横排图块 + 「+」槽,右上「已启用 n/8」)、
 * 详情区(占位/双击编辑,Esc 取消/失焦保存)、
 * 「从商品链接导入」折叠区(默认展开;底条即输入框;空输入导入置灰)。
 * 组件纯 props 驱动,不碰 store。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProductDetailSection,
  ProductImageSection,
  ProductLinkImportSection,
} from "./product-card-sections";

expect.extend(jestDomMatchers);
afterEach(() => cleanup());

const imgs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i + 1}`,
    src: `data:image/svg+xml,mock-${i + 1}`,
  }));

describe("ProductImageSection(商品图片区)", () => {
  it("空态:「已启用 0/8」+ 150px 虚线框「拖入或点击添加商品图」,点击调 onAdd", () => {
    const onAdd = vi.fn();
    render(<ProductImageSection images={[]} onAdd={onAdd} />);
    expect(screen.getByText("商品图片")).toBeInTheDocument();
    expect(screen.getByText("已启用 0/8")).toBeInTheDocument();
    const drop = screen.getByRole("button", {
      name: /拖入或点击添加商品图/,
    });
    fireEvent.click(drop);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("已填 3 张:计数 3/8、3 个图块(主图/图 2/图 3)、尾部「+」槽显示", () => {
    const onAdd = vi.fn();
    render(<ProductImageSection images={imgs(3)} onAdd={onAdd} />);
    expect(screen.getByText("已启用 3/8")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "主图" })).toHaveAttribute(
      "src",
      "data:image/svg+xml,mock-1",
    );
    expect(screen.getByRole("img", { name: "图 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加商品图" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("满 8 张:计数 8/8,尾部「+」槽隐藏", () => {
    render(<ProductImageSection images={imgs(8)} />);
    expect(screen.getByText("已启用 8/8")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加商品图" })).toBeNull();
  });

  it("图块悬停移除:点「移除图片」调 onRemove(assetId)", () => {
    const onRemove = vi.fn();
    render(<ProductImageSection images={imgs(2)} onRemove={onRemove} />);
    const removeButtons = screen.getAllByRole("button", { name: "移除图片" });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[1]);
    expect(onRemove).toHaveBeenCalledWith("a2");
  });
});

describe("ProductDetailSection(商品详情区)", () => {
  it("空 detail 显占位文案;双击进编辑,失焦 commit", () => {
    const onCommit = vi.fn();
    render(
      <ProductDetailSection
        detail=""
        placeholder="商品名称、品类、核心参数、卖点、目标人群…"
        onCommit={onCommit}
      />,
    );
    expect(screen.getByText("商品详情")).toBeInTheDocument();
    fireEvent.doubleClick(
      screen.getByText("商品名称、品类、核心参数、卖点、目标人群…"),
    );
    const textarea = screen.getByPlaceholderText(
      "商品名称、品类、核心参数、卖点、目标人群…",
    );
    fireEvent.change(textarea, { target: { value: "品类:蓝牙音箱" } });
    fireEvent.blur(textarea);
    expect(onCommit).toHaveBeenCalledWith("品类:蓝牙音箱");
  });

  it("有 detail 显内容;Esc 取消不 commit、退回展示态", () => {
    const onCommit = vi.fn();
    render(
      <ProductDetailSection
        detail="已有详情"
        placeholder="占位"
        onCommit={onCommit}
      />,
    );
    fireEvent.doubleClick(screen.getByText("已有详情"));
    const textarea = screen.getByDisplayValue("已有详情");
    fireEvent.change(textarea, { target: { value: "改过的" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    fireEvent.blur(textarea);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText("已有详情")).toBeInTheDocument();
  });
});

describe("ProductLinkImportSection(从商品链接导入)", () => {
  it("默认展开:空输入显「支持 + 5 平台图标」,导入置灰禁用", () => {
    render(<ProductLinkImportSection />);
    const title = screen.getByRole("button", { name: /从商品链接导入/ });
    expect(title).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("商品链接")).toBeInTheDocument();
    expect(screen.getByText("支持")).toBeInTheDocument();
    for (const label of ["抖", "淘", "猫", "京", "亚"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "导入" })).toBeDisabled();
  });

  it("有内容:平台占位隐藏只显 URL,导入可用,点击调 onImport(url)", () => {
    const onImport = vi.fn();
    render(<ProductLinkImportSection onImport={onImport} />);
    const input = screen.getByLabelText("商品链接");
    fireEvent.change(input, { target: { value: "https://example.com/i/1" } });
    expect(screen.queryByText("支持")).toBeNull();
    const btn = screen.getByRole("button", { name: "导入" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onImport).toHaveBeenCalledWith("https://example.com/i/1");
  });

  it("折叠:点标题收起输入区,再点展开;标题整行悬停图标+文字变白(状态驱动内联色)", () => {
    render(<ProductLinkImportSection />);
    const title = screen.getByRole("button", { name: /从商品链接导入/ });
    fireEvent.click(title);
    expect(title).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("商品链接")).toBeNull();
    fireEvent.click(title);
    expect(screen.getByLabelText("商品链接")).toBeInTheDocument();
    // 悬停:内联 color 切到 --tc-text-primary(Tailwind hover 类会被内联 style 压住,故状态驱动)
    expect(title.style.color).toBe("var(--tc-text-secondary)");
    fireEvent.mouseEnter(title);
    expect(title.style.color).toBe("var(--tc-text-primary)");
    fireEvent.mouseLeave(title);
    expect(title.style.color).toBe("var(--tc-text-secondary)");
  });

  it("initialUrl(已导入过的 sourceUrl)回填输入框", () => {
    render(
      <ProductLinkImportSection initialUrl="https://example.com/item/42" />,
    );
    expect(screen.getByLabelText("商品链接")).toHaveValue(
      "https://example.com/item/42",
    );
    // 有内容时平台占位不显示
    expect(screen.queryByText("支持")).toBeNull();
  });
});
