// @vitest-environment jsdom
/**
 * IK2AKU 回归：弹窗内按住左键拖选、移出弹窗外松开，不得意外关闭弹窗。
 *
 * 拖选释放的事件序列是 mousedown → 移动 → mouseup → click；旧实现遮罩层
 * 用 onClick 关闭，松开时指针已在遮罩上导致误关。修法：遮罩层改用
 * onMouseDown（按下瞬间才判定关闭），且内层卡片阻止 mousedown 冒泡。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoginModal } from "./LoginModal";
import { ModalShell } from "./ModalShell";

const { signUp } = vi.hoisted(() => ({
  signUp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp,
  }),
}));

vi.mock("./accountCapabilities", () => ({
  fetchAccountCapabilities: vi.fn().mockResolvedValue({
    password_login: true,
    password_register: true,
    email_verification: false,
  }),
}));

describe("ModalShell 遮罩拖选误关闭（IK2AKU）", () => {
  it("弹窗内按下、拖到遮罩上松开，不关闭", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell ariaLabel="测试弹窗" onClose={onClose}>
        <p>可选中内容</p>
      </ModalShell>,
    );
    const backdrop = container.firstChild as HTMLElement;
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("在遮罩上完整按下（意图点击外部），关闭", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell ariaLabel="测试弹窗" onClose={onClose}>
        <p>内容</p>
      </ModalShell>,
    );
    const backdrop = container.firstChild as HTMLElement;

    fireEvent.mouseDown(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("弹窗内按下左键（不拖出），不关闭", () => {
    const onClose = vi.fn();
    render(
      <ModalShell ariaLabel="测试弹窗" onClose={onClose}>
        <p>内容</p>
      </ModalShell>,
    );
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("X 按钮点击仍正常关闭", () => {
    const onClose = vi.fn();
    render(
      <ModalShell ariaLabel="测试弹窗" onClose={onClose}>
        <p>内容</p>
      </ModalShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭测试弹窗" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("遮罩上右键按压，不关闭（仅主键触发）", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell ariaLabel="测试弹窗" onClose={onClose}>
        <p>内容</p>
      </ModalShell>,
    );
    const backdrop = container.firstChild as HTMLElement;

    fireEvent.mouseDown(backdrop, { button: 2 });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("嵌套子弹窗内拖选释放，不连带关闭父弹窗", () => {
    const onParentClose = vi.fn();
    const onChildClose = vi.fn();
    render(
      <ModalShell ariaLabel="父弹窗" onClose={onParentClose}>
        <p>父内容</p>
        {/* 子弹窗渲染在父卡片内部（AccountModal 嵌套范式） */}
        <ModalShell
          ariaLabel="子弹窗"
          onClose={onChildClose}
          zIndex={2147483620}
        >
          <p>子内容</p>
        </ModalShell>
      </ModalShell>,
    );
    const childDialog = screen.getByRole("dialog", { name: "子弹窗" });
    const childBackdrop = childDialog.parentElement as HTMLElement;

    fireEvent.mouseDown(childDialog);
    fireEvent.mouseUp(childBackdrop);
    fireEvent.click(childBackdrop);

    expect(onChildClose).not.toHaveBeenCalled();
    expect(onParentClose).not.toHaveBeenCalled();
  });
});

describe("LoginModal 遮罩拖选误关闭（IK2AKU）", () => {
  it("弹窗内按下、拖到遮罩上松开，不关闭", async () => {
    const onClose = vi.fn();
    render(<LoginModal onClose={onClose} />);
    await screen.findByRole("button", { name: "创建账号" });

    const backdrop = document.querySelector(
      ".tc-login-modal-backdrop",
    ) as HTMLElement;
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("在遮罩上完整按下（意图点击外部），关闭", async () => {
    const onClose = vi.fn();
    render(<LoginModal onClose={onClose} />);
    await screen.findByRole("button", { name: "创建账号" });

    const backdrop = document.querySelector(
      ".tc-login-modal-backdrop",
    ) as HTMLElement;

    fireEvent.mouseDown(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
