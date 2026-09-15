import { describe, expect, it } from "vitest";
import {
  composeTextAttachmentPrompt,
  composeTextAttachmentPromptIndexed,
} from "./compose-text-attachment-prompt.js";

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

describe("composeTextAttachmentPromptIndexed（IKFA1P 编号清单组合）", () => {
  it("附件按序以 文本N： 行进入组合，正文追加在清单之后", () => {
    expect(
      composeTextAttachmentPromptIndexed([{ text: "背景A" }, { text: "背景B" }], "按文本1改"),
    ).toBe("文本1：背景A\n\n文本2：背景B\n\n按文本1改");
  });

  it("空白附件保留编号占位：行号与附件顺序稳定对应，不错位", () => {
    expect(
      composeTextAttachmentPromptIndexed([{ text: "  \n " }, { text: "有效" }], "任务"),
    ).toBe("文本1：  \n \n\n文本2：有效\n\n任务");
  });

  it("无附件时退化为正文本身；正文空白时不追加空段", () => {
    expect(composeTextAttachmentPromptIndexed([], "正文")).toBe("正文");
    expect(composeTextAttachmentPromptIndexed([{ text: "A" }], "  ")).toBe("文本1：A");
    expect(composeTextAttachmentPromptIndexed([], " ")).toBe("");
  });
});
