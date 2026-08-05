// @vitest-environment jsdom
/** ExpandModal(文本节点展开大编辑视图)遮罩层级回归:展开编辑是模态层,其遮罩
 *  z-index 必须高于 AgentChatPanel 悬浮层(z-[2147483600]),否则 agent 右侧
 *  对话框会视觉遮盖编辑区。修复前遮罩为 z-50,远低于悬浮层。
 *  约定见 components/SkillPanel.tsx 与 components/SkillPanel.layering.test.tsx。 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpandModal } from "./ExpandModal";

/** AgentChatPanel 悬浮层层级(AgentChatPanel.tsx 的 z-[2147483600]) */
const AGENT_PANEL_LAYER = 2147483600;

describe("ExpandModal 遮罩层级", () => {
  afterEach(cleanup);

  it("遮罩 z-index 高于 AgentChatPanel 悬浮层", () => {
    const { container } = render(
      <ExpandModal editor={null} onClose={vi.fn()} />,
    );

    const overlay = container.firstElementChild;
    expect(overlay).not.toBeNull();
    const match = overlay!.className.match(/z-\[?(\d+)\]?/);
    expect(match, "遮罩必须声明 z-index").not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(AGENT_PANEL_LAYER);
  });
});
