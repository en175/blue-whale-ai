import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261019150000_ikosu3_media_tool_pricing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/069_ikosu3_media_tool_pricing.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261019_ikosu3_media_tool_pricing.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const TOOL_TYPES = [
  "image_enhance",
  "image_outpaint",
  "image_erase",
  "image_cutout",
  "video_enhance",
  "video_frame_interpolation",
  "video_matting",
  "video_subtitle_erase",
  "video_scene_split",
  "vocal_split",
  "media_extract",
  "audio_trim",
  "audio_mix",
  "audio_speed",
  "audio_video_mux",
] as const;

describe("IKOSU3 media_tool_pricing 迁移：三轨", () => {
  it("三轨逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4，且不写注释", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
    expect(standaloneSql).not.toMatch(/^\s*--/m);
  });

  it("建表包含收费状态列，默认收费", () => {
    expect(standaloneSql).toContain(
      "`charge_enabled` BOOLEAN NOT NULL DEFAULT TRUE",
    );
    expect(standaloneSql).toContain(
      "UNIQUE KEY `uk_media_tool_pricing__tool_type` (`tool_type`)",
    );
  });

  it("15 个工具类型各一条种子，且用 INSERT IGNORE 保留已编辑配置", () => {
    expect(standaloneSql).toContain("INSERT IGNORE INTO `media_tool_pricing`");
    for (const toolType of TOOL_TYPES) {
      expect(standaloneSql).toContain(`('${toolType}',`);
    }
    expect(standaloneSql.match(/^\('image_|^\('video_|^\('vocal_|^\('media_|^\('audio_/gm))
      .toHaveLength(15);
  });

  it("工具价目使用数量偏移/步长与分钟分母", () => {
    expect(standaloneSql).toContain('"quantityOffset":1');
    expect(standaloneSql).toContain('"quantityStep":5');
    expect(standaloneSql).toContain('"quantityStep":60');
    expect(standaloneSql).toContain('"unitDenominator":60');
    expect(standaloneSql).toContain('"rounding":"ceil"');
  });

  it("Prisma schema 有对应模型与收费状态字段", () => {
    expect(schemaPrisma).toContain("model media_tool_pricing {");
    expect(schemaPrisma).toContain("charge_enabled Boolean  @default(true)");
    expect(schemaPrisma).toContain(
      '@@unique([tool_type], map: "uk_media_tool_pricing__tool_type")',
    );
  });

  it("图片工具种子价与验收口径一致（mc → 积分：放大 15/47/67，扩图/擦除 14，抠图 1）", () => {
    const seed = (tool: string) =>
      standaloneSql
        .split("\n")
        .find((line) => line.startsWith(`('${tool}',`)) ?? "";
    expect(seed("image_enhance")).toContain('"multiple=2":15000');
    expect(seed("image_enhance")).toContain('"multiple=4":47000');
    expect(seed("image_enhance")).toContain('"multiple=6":67000');
    expect(seed("image_outpaint")).toContain('"value":14000');
    expect(seed("image_erase")).toContain('"value":14000');
    expect(seed("image_cutout")).toContain('"value":1000');
  });

  it("视频工具种子价与验收口径一致（mc）", () => {
    const seed = (tool: string) =>
      standaloneSql
        .split("\n")
        .find((line) => line.startsWith(`('${tool}',`)) ?? "";
    expect(seed("video_enhance")).toContain('"resolution=1080p":4000');
    expect(seed("video_enhance")).toContain('"resolution=2k":7000');
    expect(seed("video_enhance")).toContain('"resolution=4k":15000');
    expect(seed("video_frame_interpolation")).toContain('"fps=30":45000');
    expect(seed("video_frame_interpolation")).toContain('"fps=60":90000');
    expect(seed("video_frame_interpolation")).toContain('"fps=120":180000');
    expect(seed("video_matting")).toContain('"value":200');
    expect(seed("video_subtitle_erase")).toContain('"value":38000');
    expect(seed("video_scene_split")).toContain('"value":1000');
  });
});
