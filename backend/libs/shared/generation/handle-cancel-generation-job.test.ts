import { describe, expect, it } from "vitest";

import {
  ERROR_JOB_NOT_CANCELABLE,
  RESOURCE_NOT_FOUND_CODE,
  errorCodeToNumeric,
} from "@lib/contracts";

import { handleCancelGenerationJob } from "./handle-cancel-generation-job.js";

type Outcome = "cancelled" | "not_found" | "not_cancelable";

function deps(outcome: Outcome) {
  return {
    projects: { findOwnedById: async () => ({ id: "1" }) } as never,
    command: { requestCancel: async () => outcome } as never,
  };
}

describe("取消：仅排队中的任务可取消", () => {
  it("queued → 受理", async () => {
    const result = await handleCancelGenerationJob("9", "1", "77", deps("cancelled"));

    expect(result.code).toBe(200);
  });

  it("任务不存在 → 资源不存在", async () => {
    const result = await handleCancelGenerationJob("9", "1", "77", deps("not_found"));

    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("★ processing → 1062 job_not_cancelable，不再伪装成「资源不存在」", async () => {
    const result = await handleCancelGenerationJob("9", "1", "77", deps("not_cancelable"));

    expect(result.code).toBe(errorCodeToNumeric(ERROR_JOB_NOT_CANCELABLE));
  });
});
