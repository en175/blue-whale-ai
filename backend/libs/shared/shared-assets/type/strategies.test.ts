import { describe, expect, it, vi } from "vitest";
import {
  ASSET_UNAVAILABLE_CODE,
  RESOURCE_NOT_FOUND_CODE,
  SHARED_ASSET_EMPTY_CARD_CODE,
} from "@lib/contracts";
import { StyleCardStrategy } from "./card-strategies.js";
import { MediaStrategy } from "./media-strategies.js";
import { SceneStrategy } from "./scene-strategy.js";
import { GoodsStrategy } from "./goods-strategy.js";
import { TextStrategy } from "./text-strategy.js";
import { sha256 } from "./shared-asset-type.strategy.js";
import type { SharedAssetSourcePort } from "../shared-asset-source.port.js";

const user = { userId: "1" };

describe("CardStrategy（assetType=card，kind=风格/角色/物体/环境/自定义）", () => {
  const strategy = new StyleCardStrategy();
  expect(strategy.assetType).toBe("card");
  expect(strategy.kind).toBe("style");

  it("E6：无参考图且无描述 → 拒绝保存", async () => {
    await expect(
      strategy.buildSavePlan(user, {
        assetType: "card",
        kind: "style",
        snapshot: { referenceImages: [], description: undefined },
      }),
    ).rejects.toMatchObject({ code: SHARED_ASSET_EMPTY_CARD_CODE });
  });

  it("有描述 → 名称/缩略图/去重键（card:kind:desc sha256）", async () => {
    const plan = await strategy.buildSavePlan(user, {
      assetType: "card",
      kind: "style",
      snapshot: {
        referenceImages: [{ id: "1", src: "https://x/1.png" }],
        description: "  赛博朋克  ",
      },
    });
    expect(plan.name).toBe("赛博朋克");
    expect(plan.thumbnailUrl).toBe("https://x/1.png");
    expect(plan.dedupKey).toBe(`card:style:${sha256("赛博朋克")}`);
  });

  it("空描述但有参考图 → 保存成功，跳过去重", async () => {
    const plan = await strategy.buildSavePlan(user, {
      assetType: "card",
      kind: "custom",
      snapshot: { referenceImages: [{ id: "1", src: "https://x/1.png" }] },
    });
    expect(plan.dedupKey).toBeNull();
  });
});

describe("MediaStrategy（assetType=media，kind=image/video/audio）", () => {
  const source = { findOwnedSource: vi.fn() } as unknown as SharedAssetSourcePort;
  const strategy = new MediaStrategy(source, "image");
  expect(strategy.assetType).toBe("media");
  expect(strategy.kind).toBe("image");

  it("源资产缺失 → 拒绝", async () => {
    source.findOwnedSource = vi.fn().mockResolvedValue(null);
    await expect(
      strategy.buildSavePlan(user, {
        assetType: "media",
        kind: "image",
        sourceAssetId: "9",
      }),
    ).rejects.toMatchObject({ code: ASSET_UNAVAILABLE_CODE });
  });

  it("源类型与保存 kind 不一致 → 拒绝", async () => {
    source.findOwnedSource = vi.fn().mockResolvedValue({
      type: "video",
      url: "https://x/v.mp4",
    });
    await expect(
      strategy.buildSavePlan(user, {
        assetType: "media",
        kind: "image",
        sourceAssetId: "9",
      }),
    ).rejects.toMatchObject({ code: ASSET_UNAVAILABLE_CODE });
  });

  it("合法 → 自包含快照 + url 去重键", async () => {
    source.findOwnedSource = vi.fn().mockResolvedValue({
      type: "image",
      url: "https://x/a.png",
      mime: "image/png",
      size: 100n,
      width: 10,
      height: 20,
      duration: null,
      duration_ms: null,
      storage_key: "k",
      source: "uploaded",
    });
    const plan = await strategy.buildSavePlan(user, {
      assetType: "media",
      kind: "image",
      sourceAssetId: "9",
      name: "图.png",
    });
    expect(plan.snapshot).toMatchObject({
      url: "https://x/a.png",
      mime: "image/png",
      size: 100,
      width: 10,
      height: 20,
    });
    expect(plan.thumbnailUrl).toBe("https://x/a.png");
    expect(plan.name).toBe("图.png");
    expect(plan.dedupKey).toBe(`media:${sha256("https://x/a.png")}`);
  });
});

describe("SceneStrategy（assetType=scene）", () => {
  const source = {
    findOwnedSceneCard: vi.fn(),
  } as unknown as SharedAssetSourcePort;
  const strategy = new SceneStrategy(source);
  expect(strategy.assetType).toBe("scene");
  expect(strategy.kind).toBeNull();

  it("源场景卡缺失 → 拒绝", async () => {
    source.findOwnedSceneCard = vi.fn().mockResolvedValue({ kind: "not_found" });
    await expect(
      strategy.buildSavePlan(user, {
        assetType: "scene",
        sourceSceneCardId: "7",
      }),
    ).rejects.toMatchObject({ code: RESOURCE_NOT_FOUND_CODE });
  });

  it("合法 → 内容 + 生成预设快照", async () => {
    source.findOwnedSceneCard = vi.fn().mockResolvedValue({
      kind: "found",
      scene_card: {
        title: "开场",
        summary: "summary",
        content_markdown: "# 开场\n镜头一",
        generation_preset: {
          parameters: { size: "16:9" },
          reference_mode: "first_frame",
          reference_assets: [{ mention_id: "1" }],
          capability_snapshot_version: { schema_version: 1 },
        },
      },
    });
    const plan = await strategy.buildSavePlan(user, {
      assetType: "scene",
      sourceSceneCardId: "7",
    });
    expect(plan.snapshot.title).toBe("开场");
    expect(plan.snapshot.generationPreset?.referenceMode).toBe("first_frame");
    expect(plan.dedupKey).toBe(`scene:${sha256("# 开场\n镜头一")}`);
  });
});

describe("GoodsStrategy / TextStrategy（assetType=goods/text，kind=null）", () => {
  it("商品：名称/首图/按名称去重", async () => {
    const strategy = new GoodsStrategy();
    expect(strategy.kind).toBeNull();
    const plan = await strategy.buildSavePlan(user, {
      assetType: "goods",
      snapshot: {
        name: "马克杯",
        images: [{ id: "1", src: "https://x/cup.png" }],
      },
    });
    expect(plan.name).toBe("马克杯");
    expect(plan.thumbnailUrl).toBe("https://x/cup.png");
    expect(plan.dedupKey).toBe(`goods:${sha256("马克杯")}`);
  });

  it("文本：纯文本名称，不去重", async () => {
    const strategy = new TextStrategy();
    expect(strategy.kind).toBeNull();
    const plan = await strategy.buildSavePlan(user, {
      assetType: "text",
      snapshot: { html: "<p>你好，<b>世界</b></p>" },
    });
    expect(plan.name).toBe("你好，世界");
    expect(plan.dedupKey).toBeNull();
  });
});
