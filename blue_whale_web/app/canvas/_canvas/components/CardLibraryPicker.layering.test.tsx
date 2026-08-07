// @vitest-environment jsdom
/** CardLibraryPicker(共享资产)遮罩层级回归:共享资产库是模态层,其遮罩 z-index
 *  必须高于 AgentChatPanel 悬浮层(z-[2147483600]),否则 agent 右侧对话框会
 *  视觉遮盖资产库弹窗右半部分。修复前遮罩 zIndex=50,远低于悬浮层。
 *  约定见 components/SkillPanel.tsx 与 components/SkillPanel.layering.test.tsx。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCardLibrary } from "../cardLibrary";
import { CardLibraryPicker } from "./CardLibraryPicker";

/** AgentChatPanel 悬浮层层级(AgentChatPanel.tsx 的 z-[2147483600]) */
const AGENT_PANEL_LAYER = 2147483600;

describe("CardLibraryPicker 遮罩层级", () => {
  afterEach(() => cleanup());
  beforeEach(() => resetCardLibrary());

  it("主遮罩 z-index 高于 AgentChatPanel 悬浮层", () => {
    render(<CardLibraryPicker onImport={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "共享资产" });
    const overlay = dialog.parentElement;
    expect(overlay).not.toBeNull();
    const zIndex = Number(overlay!.style.zIndex);
    expect(Number.isFinite(zIndex), "遮罩必须声明 z-index").toBe(true);
    expect(zIndex).toBeGreaterThan(AGENT_PANEL_LAYER);
  });

  it("详情浮窗 z-index 高于主遮罩", () => {
    render(<CardLibraryPicker onImport={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Apollo"));
    const detailDialog = screen.getByRole("dialog", { name: "Apollo详情" });
    const mainDialog = screen.getByRole("dialog", { name: "共享资产" });
    const detailZ = Number(detailDialog.parentElement!.style.zIndex);
    const mainZ = Number(mainDialog.parentElement!.style.zIndex);
    expect(detailZ).toBeGreaterThan(mainZ);
  });
});
