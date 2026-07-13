import { describe, it, expect } from "vitest";
import { nextRetryStatus, fromJobStatus } from "./cardStatus";
import type { CardStatus } from "./cardStatus";

describe("nextRetryStatus", () => {
  it("failed 态重试首步进入 generating（过渡，非直接成功）", () => {
    const result = nextRetryStatus("failed");

    expect(result.next).toBe("generating");
    expect(result.isTerminal).toBe(false);
  });

  it("generating 态之后进入 normal 且为终态", () => {
    const result = nextRetryStatus("generating");

    expect(result.next).toBe("normal");
    expect(result.isTerminal).toBe(true);
  });

  it("normal 态不再有重试转移（guard）", () => {
    const result = nextRetryStatus("normal");

    expect(result.next).toBe("normal");
    expect(result.isTerminal).toBe(true);
  });

  it("重试链 failed→generating→normal 两步收敛，无回退", () => {
    const trajectory: { next: CardStatus; isTerminal: boolean }[] = [];
    let current: CardStatus = "failed";
    // 迭代两次：failed → generating → normal
    for (let i = 0; i < 2; i++) {
      const step = nextRetryStatus(current);
      trajectory.push(step);
      current = step.next;
    }

    expect(trajectory.map((s) => s.next)).toEqual(["generating", "normal"]);
    expect(trajectory[1].isTerminal).toBe(true);
  });
});

describe("fromJobStatus", () => {
  it("succeeded 映射 normal（终态）", () => {
    expect(fromJobStatus("succeeded")).toBe("normal");
  });

  it("failed 映射 failed", () => {
    expect(fromJobStatus("failed")).toBe("failed");
  });

  it("queued / processing 映射 generating（过渡态）", () => {
    expect(fromJobStatus("queued")).toBe("generating");
    expect(fromJobStatus("processing")).toBe("generating");
  });

  it("未知状态保守映射 generating（等下一轮轮询）", () => {
    expect(fromJobStatus("unknown")).toBe("generating");
    expect(fromJobStatus("")).toBe("generating");
  });
});
