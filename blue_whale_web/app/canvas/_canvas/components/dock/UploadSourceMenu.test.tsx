// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { createRef } from "react";
import { UploadSourceMenu } from "./UploadSourceMenu";

expect.extend(jestDomMatchers);

function setup() {
  const triggerRef = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  const onLocalUpload = vi.fn();
  const onPickFromCanvas = vi.fn();

  const { rerender } = render(
    <>
      <button ref={triggerRef} data-testid="trigger">
        触发
      </button>
      <UploadSourceMenu
        triggerRef={triggerRef}
        open={false}
        onClose={onClose}
        onLocalUpload={onLocalUpload}
        onPickFromCanvas={onPickFromCanvas}
      />
    </>,
  );

  // 模拟触发按钮位置：left=100, width=40, top=500 → center=120
  const triggerEl = triggerRef.current!;
  vi.spyOn(triggerEl, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 140,
    top: 500,
    bottom: 530,
    width: 40,
    height: 30,
    x: 100,
    y: 500,
    toJSON: () => {},
  });

  const openMenu = () =>
    rerender(
      <>
        <button ref={triggerRef} data-testid="trigger">
          触发
        </button>
        <UploadSourceMenu
          triggerRef={triggerRef}
          open={true}
          onClose={onClose}
          onLocalUpload={onLocalUpload}
          onPickFromCanvas={onPickFromCanvas}
        />
      </>,
    );

  return { triggerRef, onClose, onLocalUpload, onPickFromCanvas, openMenu };
}

describe("UploadSourceMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("横排布局：容器 flexDirection 为 row", () => {
    const { openMenu } = setup();
    openMenu();

    const menu = screen.getByRole("menu", { name: "上传来源" });
    expect(menu.style.flexDirection).toBe("row");
  });

  it("居中对齐：left 为触发按钮中心，transform 含 translateX(-50%)", () => {
    const { openMenu } = setup();
    openMenu();

    const menu = screen.getByRole("menu", { name: "上传来源" });
    // 触发按钮 left=100, width=40 → center=120
    expect(menu.style.left).toBe("120px");
    expect(menu.style.transform).toContain("translateX(-50%)");
  });

  it("向上展开：bottom 基于窗口高度减去触发按钮 top", () => {
    const { openMenu } = setup();
    openMenu();

    const menu = screen.getByRole("menu", { name: "上传来源" });
    // window.innerHeight(768) - top(500) + 8 = 276
    expect(menu.style.bottom).toBe(`${window.innerHeight - 500 + 8}px`);
  });

  it("两个菜单项水平排列", () => {
    const { openMenu } = setup();
    openMenu();

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("本地上传");
    expect(items[1]).toHaveTextContent("从画布选择");
  });

  it("Esc 关闭", () => {
    const { openMenu, onClose } = setup();
    openMenu();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击外部关闭", () => {
    const { openMenu, onClose } = setup();
    openMenu();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击菜单项不触发关闭（由菜单项自身处理）", () => {
    const { openMenu, onClose, onLocalUpload } = setup();
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /本地上传/ }));
    expect(onLocalUpload).toHaveBeenCalledTimes(1);
    // onClose 由菜单项 onClick 内部调用
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
