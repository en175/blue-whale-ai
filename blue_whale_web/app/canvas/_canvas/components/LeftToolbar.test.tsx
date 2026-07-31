// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeftToolbar } from "./LeftToolbar";

/**
 * IK55VD 按钮 1（工具模式：鼠标/抓手）：无任何高亮，仅图标随有效模式切换——
 * 鼠标模式 = MousePointer2(20px)；抓手模式（含按住空格的临时态）= Hand(18px)。
 * IK56MS：8 入口定稿顺序与规格名、两段分隔线、1 秒延迟悬浮提示、悬浮列表选中态。
 */
describe("LeftToolbar 工具模式按钮", () => {
  const selectButton = () =>
    screen.getByRole("button", { name: "工具模式：鼠标" });

  it("默认（鼠标模式）显示 MousePointer2 20px，无手图标", () => {
    const { container } = render(<LeftToolbar />);
    const pointer = selectButton().querySelector("svg.lucide-mouse-pointer-2");
    expect(pointer).not.toBeNull();
    expect(pointer?.getAttribute("width")).toBe("20");
    expect(container.querySelector("svg.lucide-hand")).toBeNull();
  });

  it("handActive（抓手模式或按住空格）显示 Hand 18px，无指针图标", () => {
    const { container } = render(<LeftToolbar handActive />);
    const hand = screen
      .getByRole("button", { name: "工具模式：抓手" })
      .querySelector("svg.lucide-hand");
    expect(hand).not.toBeNull();
    expect(hand?.getAttribute("width")).toBe("18");
    expect(container.querySelector("svg.lucide-mouse-pointer-2")).toBeNull();
  });

  it("按钮无任何高亮：两种模式下 className 完全一致", () => {
    const { unmount } = render(<LeftToolbar />);
    const mouseClass = selectButton().className;
    unmount();
    render(<LeftToolbar handActive />);
    const handClass = screen.getByRole("button", {
      name: "工具模式：抓手",
    }).className;
    expect(handClass).toBe(mouseClass);
  });

  it("点击按钮 1 上抛 select（由页面层 toggle 持久模式）", () => {
    const onToolClick = vi.fn();
    render(<LeftToolbar onToolClick={onToolClick} />);
    fireEvent.click(selectButton());
    expect(onToolClick).toHaveBeenCalledWith("select", expect.anything());
  });
});

describe("LeftToolbar 8 入口组装（IK56MS 定稿）", () => {
  afterEach(() => vi.useRealTimers());

  it("8 个入口按定稿顺序渲染，可访问名称为规格名", () => {
    render(<LeftToolbar />);
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "工具模式：鼠标",
      "上传附件",
      "图像生成",
      "视频生成",
      "音频生成",
      "文本编辑卡",
      "资产库",
      "商品卡",
    ]);
  });

  it("两条分隔线（工具｜生成｜库三段），截图片号 7/8/9 不渲染", () => {
    const { container } = render(<LeftToolbar />);
    expect(container.getElementsByClassName("shrink-0")).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("商品卡按钮为购物袋图标（定稿 A 图标）", () => {
    render(<LeftToolbar />);
    const btn = screen.getByRole("button", { name: "商品卡" });
    expect(btn.querySelector("svg.lucide-shopping-bag")).not.toBeNull();
  });

  it("点击映射：每个按钮上抛对应工具 id", () => {
    const onToolClick = vi.fn();
    render(<LeftToolbar onToolClick={onToolClick} />);
    const cases: [string, string][] = [
      ["工具模式：鼠标", "select"],
      ["上传附件", "upload"],
      ["图像生成", "ai-image"],
      ["视频生成", "ai-video"],
      ["音频生成", "audio"],
      ["文本编辑卡", "text"],
      ["资产库", "asset-library"],
      ["商品卡", "product-card"],
    ];
    for (const [name, id] of cases) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(onToolClick).toHaveBeenLastCalledWith(id, expect.anything());
    }
    expect(onToolClick).toHaveBeenCalledTimes(8);
  });

  it("悬浮列表展开期间触发按钮保持选中背景，其余按钮不受影响", () => {
    render(<LeftToolbar activeFlyoutToolId="audio" />);
    // hover:bg-white/[0.08] 含同名子串，须按独立类名匹配
    const selectedRe = /(^|\s)bg-white\/\[0\.08\]/;
    expect(screen.getByRole("button", { name: "音频生成" }).className).toMatch(
      selectedRe,
    );
    const productClass = screen.getByRole("button", {
      name: "商品卡",
    }).className;
    expect(productClass).not.toMatch(selectedRe);
    expect(productClass).toContain("bg-transparent");
  });

  it("悬浮提示：悬停满 1 秒才显示纯规格名，移出即消失", () => {
    vi.useFakeTimers();
    render(<LeftToolbar />);
    const btn = screen.getByRole("button", { name: "上传附件" });
    fireEvent.mouseEnter(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(999));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip")).toHaveTextContent("上传附件");
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("悬停不足 1 秒移出：提示不显示", () => {
    vi.useFakeTimers();
    render(<LeftToolbar />);
    const btn = screen.getByRole("button", { name: "商品卡" });
    fireEvent.mouseEnter(btn);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.mouseLeave(btn);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("按钮 1 提示随模式变化：鼠标=工具模式，抓手=工具模式：抓手", () => {
    vi.useFakeTimers();
    const { unmount } = render(<LeftToolbar />);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "工具模式：鼠标" }),
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("tooltip")).toHaveTextContent("工具模式");
    unmount();
    render(<LeftToolbar handActive />);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "工具模式：抓手" }),
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("tooltip")).toHaveTextContent("工具模式：抓手");
  });
});
