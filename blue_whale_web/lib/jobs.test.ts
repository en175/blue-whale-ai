import { describe, it, expect } from "vitest";
import { mapJobStatusToCardStatus, isJobTerminal } from "./jobs";

describe("mapJobStatusToCardStatus（CONTEXT.md L79-80 视图映射）", () => {
  it("processing → generating（生成中显示过渡态）", () => {
    expect(mapJobStatusToCardStatus("processing")).toBe("generating");
  });

  it("succeeded → normal（完成后回到稳定态）", () => {
    expect(mapJobStatusToCardStatus("succeeded")).toBe("normal");
  });

  it("failed → failed（失败态直接透传）", () => {
    expect(mapJobStatusToCardStatus("failed")).toBe("failed");
  });

  it("queued → generating（队列中视为过渡态，与 processing UI 一致）", () => {
    expect(mapJobStatusToCardStatus("queued")).toBe("generating");
  });
});

describe("isJobTerminal", () => {
  it("succeeded 是终态", () => {
    expect(
      isJobTerminal({
        id: "j",
        status: "succeeded",
        createdAt: 0,
      }),
    ).toBe(true);
  });

  it("failed 是终态", () => {
    expect(
      isJobTerminal({
        id: "j",
        status: "failed",
        createdAt: 0,
      }),
    ).toBe(true);
  });

  it("queued / processing 非终态", () => {
    expect(
      isJobTerminal({ id: "j", status: "queued", createdAt: 0 }),
    ).toBe(false);
    expect(
      isJobTerminal({ id: "j", status: "processing", createdAt: 0 }),
    ).toBe(false);
  });
});