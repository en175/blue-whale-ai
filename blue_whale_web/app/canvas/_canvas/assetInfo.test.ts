import { describe, expect, it } from "vitest";

import type { Asset } from "./model";
import { buildAssetInfoRows } from "./assetInfo";

function values(asset: Asset) {
  return Object.fromEntries(
    buildAssetInfoRows(asset).map((row) => [row.label, row.value]),
  );
}

describe("buildAssetInfoRows", () => {
  it("图片展示中文类型、尺寸和格式，不展示时长", () => {
    const rows = buildAssetInfoRows({
      id: "41",
      kind: "image",
      src: "https://tos.test/internal.png",
      width: 1920,
      height: 1080,
      duration: 12,
      mimeType: "image/png",
    });

    expect(Object.fromEntries(rows.map((row) => [row.label, row.value]))).toEqual({
      类型: "图片",
      尺寸: "1920 × 1080",
      格式: "PNG",
    });
  });

  it("视频展示时长并把 QuickTime MIME 转为 MOV", () => {
    expect(
      values({
        id: "42",
        kind: "video",
        width: 1280,
        height: 720,
        duration: 65.9,
        mimeType: "video/quicktime",
      }),
    ).toEqual({
      类型: "视频",
      尺寸: "1280 × 720",
      时长: "1:05",
      格式: "MOV",
    });
  });

  it("音频尺寸显示不适用，时长和 MP3 格式仍展示", () => {
    expect(
      values({
        id: "43",
        kind: "audio",
        duration: 8.2,
        mimeType: "audio/mpeg",
      }),
    ).toEqual({
      类型: "音频",
      尺寸: "不适用",
      时长: "0:08",
      格式: "MP3",
    });
  });

  it("缺失或无效元数据使用用户可理解的未知值", () => {
    expect(
      values({
        id: "44",
        kind: "video",
        width: 0,
        height: Number.NaN,
        duration: -1,
        mimeType: "application/octet-stream",
      }),
    ).toEqual({
      类型: "视频",
      尺寸: "未知",
      时长: "未知",
      格式: "未知",
    });
  });
});
