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
});
