// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolbarFlyout } from "./ToolbarFlyout";

expect.extend(jestDomMatchers);

const ITEMS = [
  { id: "audio", label: "音频生成" },
  { id: "music", label: "AI 音乐" },
];

describe("ToolbarFlyout（IK55VM 悬浮列表公共组件）", () => {
  afterEach(() => cleanup());

  /** 真实锚点元素（组件渲染期直读 getBoundingClientRect，null 不渲染）。 */
  function makeAnchor() {
    const el = document.createElement("button");
    document.body.appendChild(el);
    return el;
  }

  it("open=false 不渲染", () => {
    render(
      <ToolbarFlyout
        open={false}
        anchor={makeAnchor()}
        items={ITEMS}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("anchor=null 不渲染", () => {
    render(
      <ToolbarFlyout
        open
        anchor={null}
        items={ITEMS}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("open=true 渲染全部清单项", () => {
    render(
      <ToolbarFlyout
        open
        anchor={makeAnchor()}
        items={ITEMS}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["音频生成", "AI 音乐"]);
  });

  it("点选：先 onClose 再 onSelect(id)", () => {
    const calls: string[] = [];
    render(
      <ToolbarFlyout
        open
        anchor={makeAnchor()}
        items={ITEMS}
        onSelect={(id) => calls.push(`select:${id}`)}
        onClose={() => calls.push("close")}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "AI 音乐" }));
    expect(calls).toEqual(["close", "select:music"]);
  });

  it("Esc 关闭", () => {
    const onClose = vi.fn();
    render(
      <ToolbarFlyout
        open
        anchor={makeAnchor()}
        items={ITEMS}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点外关闭", () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside" />
        <ToolbarFlyout
          open
          anchor={makeAnchor()}
          items={ITEMS}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点锚点按钮不触发点外关闭（由调用方 toggle）", () => {
    const onClose = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <ToolbarFlyout
        open
        anchor={anchor}
        items={ITEMS}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    anchor.remove();
  });

  it("disabled 项（IK55VS 导入卡片置灰）：不可点、不触发 onSelect/onClose、呈现 hint", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ToolbarFlyout
        open
        anchor={makeAnchor()}
        items={[
          { id: "import", label: "导入卡片", disabled: true, hint: "后续" },
          ...ITEMS,
        ]}
        onSelect={onSelect}
        onClose={onClose}
      />,
    );
    const btn = screen.getByRole("menuitem", { name: /导入卡片/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText("后续")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("点外关闭走捕获阶段：冒泡链被 stopPropagation（如画布 pane）也能关闭（IK56MS 反馈 5）", () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="canvas-pane" />
        <ToolbarFlyout
          open
          anchor={makeAnchor()}
          items={ITEMS}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      </div>,
    );
    // 模拟 React Flow pane：原生冒泡阶段 stopPropagation，冒泡监听将收不到此次点击
    const pane = screen.getByTestId("canvas-pane");
    pane.addEventListener("mousedown", (e) => e.stopPropagation());
    fireEvent.mouseDown(pane);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("定位：与锚定按钮顶对齐、距工具栏外框 6px（left=按钮右缘+14，无垂直居中 transform）", () => {
    const anchor = makeAnchor();
    anchor.getBoundingClientRect = () =>
      ({
        right: 40,
        top: 100,
        height: 32,
        left: 8,
        bottom: 132,
        width: 32,
        x: 8,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    render(
      <ToolbarFlyout
        open
        anchor={anchor}
        items={ITEMS}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("54px");
    expect(menu.style.top).toBe("100px");
    expect(menu.style.transform).toBe("");
    anchor.remove();
  });
});
