// @vitest-environment jsdom
/**
 * IK5MC9 保存到共享资产：菜单项按 hideSaveToAssets 渲染 + toast 文案契约。
 * （保存数据行为由 cardLibrary.test.ts 覆盖；runtime 点击接线见 add-to-chat/菜单 action 测试。）
 */
import { cleanup, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { savedAssetsToastText } from "../cardLibrary";
import { NodeContextMenu } from "./NodeContextMenu";

expect.extend(jestDomMatchers);
afterEach(() => cleanup());

describe("IK5MC9 保存到共享资产", () => {
  it("分组节点右键不渲染「保存到共享资产」菜单项", () => {
    render(
      <NodeContextMenu
        screenX={100}
        screenY={100}
        hideSaveToAssets
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("保存到共享资产")).not.toBeInTheDocument();
  });

  it("非分组节点右键渲染「保存到共享资产」菜单项", () => {
    render(
      <NodeContextMenu
        screenX={100}
        screenY={100}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("保存到共享资产")).toBeInTheDocument();
  });

  it("toast 文案契约：0 项不提示，1 项单数，多项带数量", () => {
    expect(savedAssetsToastText(0)).toBeNull();
    expect(savedAssetsToastText(1)).toBe("已保存到共享资产");
    expect(savedAssetsToastText(3)).toBe("已保存 3 项到共享资产");
  });
});
