// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LeftToolbar } from "./LeftToolbar";

/**
 * IK55VD 按钮 1（选择/抓手）：无任何高亮，仅图标随有效模式切换——
 * 鼠标模式 = MousePointer2(20px)；抓手模式（含按住空格的临时态）= Hand(18px)。
 */
describe("LeftToolbar 工具模式按钮", () => {
  const selectButton = () => screen.getByRole("button", { name: "选择" });

  it("默认（鼠标模式）显示 MousePointer2 20px，无手图标", () => {
    const { container } = render(<LeftToolbar />);
    const pointer = selectButton().querySelector("svg.lucide-mouse-pointer-2");
    expect(pointer).not.toBeNull();
    expect(pointer?.getAttribute("width")).toBe("20");
    expect(container.querySelector("svg.lucide-hand")).toBeNull();
  });

  it("handActive（抓手模式或按住空格）显示 Hand 18px，无指针图标", () => {
    const { container } = render(<LeftToolbar handActive />);
    const hand = selectButton().querySelector("svg.lucide-hand");
    expect(hand).not.toBeNull();
    expect(hand?.getAttribute("width")).toBe("18");
    expect(container.querySelector("svg.lucide-mouse-pointer-2")).toBeNull();
  });

  it("按钮无任何高亮：两种模式下 className 完全一致", () => {
    render(<LeftToolbar />);
    const mouseClass = selectButton().className;
    render(<LeftToolbar handActive />);
    const handClass = screen.getAllByRole("button", { name: "选择" })[1]
      .className;
    expect(handClass).toBe(mouseClass);
  });

  it("点击按钮 1 上抛 select（由页面层 toggle 持久模式）", () => {
    const onToolClick = vi.fn();
    render(<LeftToolbar onToolClick={onToolClick} />);
    fireEvent.click(selectButton());
    expect(onToolClick).toHaveBeenCalledWith("select");
  });
});
