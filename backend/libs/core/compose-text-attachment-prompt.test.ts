import { describe, expect, it } from "vitest";
import { composeTextAttachmentPrompt } from "./compose-text-attachment-prompt.js";

describe("composeTextAttachmentPrompt", () => {
  it("returns the prompt unchanged when there are no attachments", () => {
    expect(composeTextAttachmentPrompt([], "画一只猫")).toBe("画一只猫");
  });

  it("uses attachment text alone when the target prompt is empty", () => {
    expect(composeTextAttachmentPrompt([{ text: "角色设定：林" }], "")).toBe("角色设定：林");
  });

  it("joins attachments in order and appends the target prompt last", () => {
    expect(
      composeTextAttachmentPrompt([{ text: "背景A" }, { text: "背景B" }], "本次任务"),
    ).toBe("背景A\n\n背景B\n\n本次任务");
  });

  it("skips blank-only attachment texts", () => {
    expect(composeTextAttachmentPrompt([{ text: "  \n " }, { text: "有效" }], "任务")).toBe("有效\n\n任务");
  });

  it("returns empty when everything is blank", () => {
    expect(composeTextAttachmentPrompt([{ text: "   " }], "  ")).toBe("");
  });
});
