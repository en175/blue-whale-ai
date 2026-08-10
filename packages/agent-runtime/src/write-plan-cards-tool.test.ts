import { describe, expect, it } from "vitest";

import {
  executeWritePlanCardsTool,
  writePlanCardsToolInputSchema,
} from "./write-plan-cards-tool.js";

describe("executeWritePlanCardsTool", () => {
  it("validates card shape and stages a count without promoting to PlanMessage (T09)", async () => {
    const parsed = writePlanCardsToolInputSchema.parse({
      cards: [
        {
          application_kind: "image_generate",
          title: "镜头一",
          summary: "蓝鲸入水",
          content_markdown: "# 镜头一",
        },
        {
          application_kind: "scene_card_create",
          title: "镜头二",
          summary: null,
          content_markdown: "# 镜头二",
        },
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

  it("rejects scene_card_replace mixed with another card", () => {
    expect(() =>
      writePlanCardsToolInputSchema.parse({
        cards: [
          {
            application_kind: "image_generate",
            title: "海报",
            content_markdown: "# 海报",
          },
          {
            application_kind: "scene_card_replace",
            title: "覆盖分镜",
            content_markdown: "# 覆盖分镜",
            target_scene_card_mention_id: "202",
          },
        ],
      }),
    ).toThrow("scene_card_replace must be the only card in its batch");
  });
});
