import { describe, expect, it } from "vitest";
import { LEFT_TOOLS, toolbarForKind } from "./config";

describe("Canvas node toolbar", () => {
  it("视频节点暂不展示提取音频入口", () => {
    expect(toolbarForKind("video").map((action) => action.id)).not.toContain(
      "extract-audio",
    );
  });
});

describe("LEFT_TOOLS 8 入口组装（IK56MS 定稿）", () => {
  it("入口数量=8，id 顺序固定为规格顺序", () => {
    expect(LEFT_TOOLS.map((t) => t.id)).toEqual([
      "select",
      "upload",
      "ai-image",
      "ai-video",
      "audio",
      "text",
      "asset-library",
      "product-card",
    ]);
  });

  it("label 为规格名（作 aria-label 与悬浮提示文案）", () => {
    expect(LEFT_TOOLS.map((t) => t.label)).toEqual([
      "工具模式",
      "上传附件",
      "图像生成",
      "视频生成",
      "音频生成",
      "文本编辑卡",
      "资产库",
      "商品卡",
    ]);
  });

  it("分隔位置：上传附件后与文本编辑卡后各一条（工具｜生成｜库三段）", () => {
    expect(LEFT_TOOLS.filter((t) => t.divider).map((t) => t.id)).toEqual([
      "upload",
      "text",
    ]);
  });
});
