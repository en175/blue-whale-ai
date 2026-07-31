// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeContextMenu } from "./NodeContextMenu";

expect.extend(jestDomMatchers);
afterEach(() => cleanup());

function renderMenu(
  overrides: Partial<React.ComponentProps<typeof NodeContextMenu>> = {},
) {
  const onAction = overrides.onAction ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <NodeContextMenu
      screenX={100}
      screenY={100}
      onAction={onAction}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onAction, onClose };
}

describe("NodeContextMenu", () => {
  it("renders 5 menu items in fixed order", () => {
    renderMenu();
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("添加到聊天");
    expect(items[1]).toHaveTextContent("保存到共享资产");
    expect(items[2]).toHaveTextContent("拷贝");
    expect(items[3]).toHaveTextContent("复制");
    expect(items[4]).toHaveTextContent("删除");
  });

  it("shows keyboard shortcuts for copy and duplicate", () => {
    renderMenu();
    expect(screen.getByText("⌘C")).toBeInTheDocument();
    expect(screen.getByText("⌘D")).toBeInTheDocument();
  });

  it("dispatches correct action on click", () => {
    const { onAction } = renderMenu();
    fireEvent.click(screen.getByText("删除"));
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it.each([
    ["添加到聊天", "add-to-chat"],
    ["保存到共享资产", "save-to-assets"],
    ["拷贝", "copy"],
    ["复制", "duplicate"],
    ["删除", "delete"],
  ] as const)("clicking「%s」dispatches '%s'", (label, action) => {
    const { onAction } = renderMenu();
    fireEvent.click(screen.getByText(label));
    expect(onAction).toHaveBeenCalledWith(action);
  });

  it("closes on Escape key", () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on outside click (deferred)", async () => {
    vi.useFakeTimers();
    const { onClose } = renderMenu();
    vi.advanceTimersByTime(10);
    fireEvent.click(window);
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not close when clicking inside menu", () => {
    vi.useFakeTimers();
    const { onClose } = renderMenu();
    vi.advanceTimersByTime(10);
    fireEvent.click(screen.getByTestId("node-context-menu"));
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("applies destructive style to delete item", () => {
    renderMenu();
    const deleteBtn = screen.getByText("删除").closest("button");
    expect(deleteBtn?.style.color).toBe("var(--tc-destructive)");
  });

  it("renders 4 items when hideSaveToAssets is true (group node)", () => {
    renderMenu({ hideSaveToAssets: true });
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(4);
    expect(screen.queryByText("保存到共享资产")).not.toBeInTheDocument();
    expect(items[0]).toHaveTextContent("添加到聊天");
    expect(items[1]).toHaveTextContent("拷贝");
    expect(items[2]).toHaveTextContent("复制");
    expect(items[3]).toHaveTextContent("删除");
  });
});
