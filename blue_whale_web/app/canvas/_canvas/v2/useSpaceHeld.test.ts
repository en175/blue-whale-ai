// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSpaceHeld } from "./useSpaceHeld";

/**
 * IK55VD 空格临时抓手：window 级 keydown/keyup 监听 e.code === "Space"，
 * input/textarea/contenteditable 内跳过，window blur 复位。
 * 注：jsdom 未实现 isContentEditable，用 defineProperty 模拟该路径。
 */
describe("useSpaceHeld", () => {
  const pressSpace = (target?: HTMLElement) => {
    const event = new KeyboardEvent("keydown", {
      code: "Space",
      bubbles: true,
    });
    act(() => {
      (target ?? window).dispatchEvent(event);
    });
  };
  const releaseSpace = () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    });
  };

  it("按住空格为 true，松开还原为 false", () => {
    const { result } = renderHook(() => useSpaceHeld());
    expect(result.current).toBe(false);

    pressSpace();
    expect(result.current).toBe(true);

    releaseSpace();
    expect(result.current).toBe(false);
  });

  it("非空格键不影响状态", () => {
    const { result } = renderHook(() => useSpaceHeld());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    });
    expect(result.current).toBe(false);
  });

  it("input / textarea 内按空格不触发", () => {
    const { result } = renderHook(() => useSpaceHeld());
    for (const tag of ["input", "textarea"]) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      pressSpace(el);
      expect(result.current).toBe(false);
      el.remove();
    }
  });

  it("contenteditable 内按空格不触发", () => {
    const { result } = renderHook(() => useSpaceHeld());
    const el = document.createElement("div");
    Object.defineProperty(el, "isContentEditable", { value: true });
    document.body.appendChild(el);
    pressSpace(el);
    expect(result.current).toBe(false);
    el.remove();
  });

  it("window blur 时复位（防止切窗后卡在手模式）", () => {
    const { result } = renderHook(() => useSpaceHeld());
    pressSpace();
    expect(result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current).toBe(false);
  });

  it("unmount 后移除监听（不再响应按键）", () => {
    const { result, unmount } = renderHook(() => useSpaceHeld());
    unmount();
    pressSpace();
    expect(result.current).toBe(false);
  });
});
