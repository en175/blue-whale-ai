// @vitest-environment jsdom
/**
 * IK55VX 卡片库选择器(共享资产)组件测试 — 组件层 seam。
 * 只测外部可观察行为:网格渲染、类型筛选、搜索、详情导入、···菜单、多选模式。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCardLibrary } from "../cardLibrary";
import { CardLibraryPicker } from "./CardLibraryPicker";

expect.extend(jestDomMatchers);

describe("CardLibraryPicker(IK55VX 共享资产选择器)", () => {
  afterEach(() => cleanup());
  beforeEach(() => resetCardLibrary());

  function renderPicker(onImport = vi.fn(), onClose = vi.fn()) {
    render(<CardLibraryPicker onImport={onImport} onClose={onClose} />);
    return { onImport, onClose };
  }

  it("打开显示「共享资产」模态,网格展示 mock 卡片(名称+类型徽章+日期)", () => {
    renderPicker();
    expect(
      screen.getByRole("dialog", { name: "共享资产" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("赛博朋克霓虹")).toBeInTheDocument();
    // 类型徽章与日期
    expect(screen.getAllByText("角色").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026-07-30").length).toBeGreaterThan(0);
  });

  it("「资产 ▾」下拉按类型筛选:选「风格」后只剩风格卡", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "资产" }));
    fireEvent.click(screen.getByRole("button", { name: "风格" }));
    expect(screen.getByText("赛博朋克霓虹")).toBeInTheDocument();
    expect(screen.getByText("水彩手绘")).toBeInTheDocument();
    expect(screen.queryByText("Apollo")).toBeNull();
  });

  it("搜索框按名称过滤", () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText("搜索资产"), {
      target: { value: "Apollo" },
    });
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.queryByText("赛博朋克霓虹")).toBeNull();
  });

  it("点击卡片弹详情浮窗(描述+「添加到画布」),点「添加到画布」触发 onImport 并关详情", () => {
    const { onImport } = renderPicker();
    fireEvent.click(screen.getByText("Apollo"));
    const detail = screen.getByRole("dialog", { name: "Apollo详情" });
    expect(within(detail).getByText(/Young lean man/)).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "添加到画布" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toMatchObject({
      id: "lib-c1",
      cardType: "character",
      name: "Apollo",
    });
    expect(screen.queryByRole("dialog", { name: "Apollo详情" })).toBeNull();
    // 主模态仍在(导入后由调用方决定关闭)
    expect(
      screen.getByRole("dialog", { name: "共享资产" }),
    ).toBeInTheDocument();
  });

  it("详情浮窗 X/ESC 只关详情,主模态保持打开", () => {
    renderPicker();
    fireEvent.click(screen.getByText("Apollo"));
    expect(
      screen.getByRole("dialog", { name: "Apollo详情" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Apollo详情" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "共享资产" }),
    ).toBeInTheDocument();
  });

  it("主模态 ESC 关闭(onClose)", () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("「···」菜单:添加到画布直接导入;移除资产把卡从网格删掉", () => {
    const { onImport } = renderPicker();
    // 添加到画布
    fireEvent.click(screen.getByRole("button", { name: "Apollo更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "添加到画布" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toMatchObject({ id: "lib-c1" });
    expect(screen.getByText("Apollo")).toBeInTheDocument(); // 导入不移除库卡
    // 移除资产
    fireEvent.click(screen.getByRole("button", { name: "复古相机更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "移除资产" }));
    expect(screen.queryByText("复古相机")).toBeNull();
    expect(screen.getByText("Apollo")).toBeInTheDocument();
  });

  it("「选择」进入多选:勾选多张后「添加 n 项」批量导入并退出多选", () => {
    const { onImport } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(screen.getByText("Apollo"));
    fireEvent.click(screen.getByText("赛博朋克霓虹"));
    fireEvent.click(screen.getByRole("button", { name: "添加 2 项" }));
    expect(onImport).toHaveBeenCalledTimes(2);
    // 退出多选模式,「选择」按钮回来
    expect(screen.getByRole("button", { name: "选择" })).toBeInTheDocument();
  });

  it("cardTypeFilter 限定可选类型(商品卡导入复用入口)", () => {
    render(
      <CardLibraryPicker
        onImport={vi.fn()}
        onClose={vi.fn()}
        cardTypeFilter={["style"]}
      />,
    );
    expect(screen.getByText("赛博朋克霓虹")).toBeInTheDocument();
    expect(screen.queryByText("Apollo")).toBeNull();
  });

  it('IK55VZ cardTypeFilter=["product"] 只看到商品卡;导入回调带商品卡原数据(快照由调用方 clone)', () => {
    const onImport = vi.fn();
    render(
      <CardLibraryPicker
        onImport={onImport}
        onClose={vi.fn()}
        cardTypeFilter={["product"]}
      />,
    );
    expect(screen.getByText("户外蓝牙音箱")).toBeInTheDocument();
    expect(screen.getByText("露营氛围灯")).toBeInTheDocument();
    expect(screen.queryByText("Apollo")).toBeNull();
    expect(screen.queryByText("赛博朋克霓虹")).toBeNull();
    // 导入:详情 → 添加到画布,回调查到库内商品卡(detail/imageAssetIds/sourceUrl 原数据)
    fireEvent.click(screen.getByText("户外蓝牙音箱"));
    const detail = screen.getByRole("dialog", { name: "户外蓝牙音箱详情" });
    fireEvent.click(within(detail).getByRole("button", { name: "添加到画布" }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toMatchObject({
      id: "lib-p1",
      cardType: "product",
      sourceUrl: "https://example.com/item/speaker-42",
    });
    expect(onImport.mock.calls[0][0].imageAssetIds).toHaveLength(3);
  });
});
