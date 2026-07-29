import { describe, expect, it } from "vitest";
import { toolbarForKind } from "./config";

describe("Canvas node toolbar", () => {
  it("视频节点暂不展示提取音频入口", () => {
    expect(toolbarForKind("video").map((action) => action.id)).not.toContain(
      "extract-audio",
    );
  });
});
