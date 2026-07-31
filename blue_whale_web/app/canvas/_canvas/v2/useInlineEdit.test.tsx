// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useInlineEdit } from "./useInlineEdit";

/**
 * IK5JV6 useInlineEdit:双击进入编辑;失焦提交;Esc 取消(当次 blur 不提交,
 * 且取消标记复位、不影响下一次编辑提交)。
 */
function Harness({ onCommit }: { onCommit?: (text: string) => void }) {
  const edit = useInlineEdit(onCommit);
  return edit.editing ? (
    <input
      aria-label="编辑器"
      defaultValue="初始文本"
      onBlur={edit.handleBlur}
      onKeyDown={edit.handleKeyDown}
    />
  ) : (
    <button type="button" onDoubleClick={edit.startEditing}>
      显示文本
    </button>
  );
}

describe("useInlineEdit", () => {
  it("双击进入编辑态", () => {
    render(<Harness />);
    fireEvent.doubleClick(screen.getByText("显示文本"));
    expect(screen.getByLabelText("编辑器")).toBeTruthy();
  });

  it("失焦提交当前值并退出编辑态", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("显示文本"));
    const input = screen.getByLabelText("编辑器");
    fireEvent.change(input, { target: { value: "改过的文本" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("改过的文本");
    expect(screen.queryByLabelText("编辑器")).toBeNull();
  });

  it("Esc 取消:当次 blur 不提交", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("显示文本"));
    const input = screen.getByLabelText("编辑器");
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("编辑器")).toBeNull();
  });

  it("Esc 取消标记复位:下一次编辑失焦正常提交", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    // 第一次:Esc 取消
    fireEvent.doubleClick(screen.getByText("显示文本"));
    const first = screen.getByLabelText("编辑器");
    fireEvent.keyDown(first, { key: "Escape" });
    fireEvent.blur(first);
    // 第二次:失焦提交
    fireEvent.doubleClick(screen.getByText("显示文本"));
    const input = screen.getByLabelText("编辑器");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("初始文本");
  });

  it("非 Esc 按键不取消也不提交", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.doubleClick(screen.getByText("显示文本"));
    const input = screen.getByLabelText("编辑器");
    fireEvent.keyDown(input, { key: "a" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("编辑器")).toBeTruthy();
  });
});
