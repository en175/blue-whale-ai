import { describe, expect, it } from "vitest";

import {
  executeWritePlanCardsTool,
  writePlanCardsToolInputSchema,
} from "./write-plan-cards-tool.js";

describe("executeWritePlanCardsTool (T08 占位)", () => {
  it("validates card shape and stages a count without promoting to PlanMessage (T09)", async () => {
    const parsed = writePlanCardsToolInputSchema.parse({
      cards: [
        { title: "镜头一", summary: "蓝鲸入水", content_markdown: "# 镜头一" },
        { title: "镜头二", summary: null, content_markdown: "# 镜头二" },
      ],
    });
    const outcome = await executeWritePlanCardsTool(parsed);
    expect(outcome).toEqual({
      kind: "ok",
      staged_card_count: 2,
      promoted: false,
    });
  });

  it("rejects an empty card list at the schema boundary", () => {
    expect(() =>
      writePlanCardsToolInputSchema.parse({ cards: [] }),
    ).toThrowError();
  });

  it("rejects cards missing required fields at the schema boundary", () => {
    expect(() =>
      writePlanCardsToolInputSchema.parse({
        cards: [{ title: "镜头一", summary: null }],
      }),
    ).toThrowError();
  });
});
