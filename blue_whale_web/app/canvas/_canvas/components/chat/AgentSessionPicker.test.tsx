// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentSessionPicker } from "./AgentSessionPicker";

const sessions = [
  {
    session_id: "session-recent",
    title: "最近的品牌讨论",
    title_source: "agent_generated" as const,
    phase: "open" as const,
    lifecycle: "active" as const,
    active_run_id: null,
    pending_message_count: 0,
    created_at: "2026-08-12T02:00:00.000Z",
    updated_at: "2026-08-12T02:00:00.000Z",
    etag: 'W/"session-2"',
  },
  {
    session_id: "session-old",
    title: "旧会话",
    title_source: "user" as const,
    phase: "open" as const,
    lifecycle: "active" as const,
    active_run_id: null,
    pending_message_count: 0,
    created_at: "2026-08-11T02:00:00.000Z",
    updated_at: "2026-08-11T02:00:00.000Z",
    etag: 'W/"session-1"',
  },
];

describe("AgentSessionPicker", () => {
  it("shows Project Sessions and exposes selection and new-conversation actions", () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();
    render(
      <AgentSessionPicker
        sessions={sessions}
        selectedSessionId="session-recent"
        onSelect={onSelect}
        onNew={onNew}
      />,
    );

    expect(screen.getAllByText("最近的品牌讨论").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("旧会话"));
    expect(onSelect).toHaveBeenCalledWith("session-old");
    fireEvent.click(screen.getByRole("button", { name: "新建 Agent 对话" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
