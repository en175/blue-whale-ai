// @vitest-environment jsdom
/** Sidebar 导航测试（IK25EG）：新增「项目」Tab 的入口、选中态与 canvas 自隐藏。 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: "/" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

beforeEach(() => {
  pathnameRef.current = "/";
});

describe("Sidebar 项目 Tab", () => {
  it("导航包含指向 /projects 的「项目」入口", () => {
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "项目" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });

  it("位于 /projects 时「项目」显示选中态", () => {
    pathnameRef.current = "/projects";
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "项目" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("位于其他路由时「项目」不选中", () => {
    pathnameRef.current = "/assets";
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "项目" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("canvas 路由下整个 Sidebar 自隐藏", () => {
    pathnameRef.current = "/canvas";
    const { container } = render(<Sidebar />);

    expect(container).toBeEmptyDOMElement();
  });
});
