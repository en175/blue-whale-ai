import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261012120000_ikl406_charge_on_submit_pricing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/063_ikl406_charge_on_submit_pricing.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261012_ikl406_charge_on_submit_pricing.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

const VIDEO_MODELS = [
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
  "doubao-seedance-2-5-260628",
] as const;

const updates = sqlCode
  .split(/;\s*\n/)
  .map((block) => block.trim())
  .filter((block) => /^UPDATE `generation_model_capability`/.test(block));

function blockOf(modelId: string): string {
  const found = updates.filter((block) => block.includes(`\`model_id\` = '${modelId}'`));
  expect(found, `${modelId} 应当恰好一条 UPDATE`).toHaveLength(1);
  return found[0]!;
}

describe("IKL406 价目迁移：三轨", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 是纯数据迁移：没有任何 DDL", () => {
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
  });

  it("★ 五个模型各一条 UPDATE，全部带 is_delete 过滤", () => {
    expect(updates).toHaveLength(5);
    for (const block of updates) {
      expect(block).toContain("`is_delete` = 0");
      expect(block).toContain("JSON_OBJECT(");
    }
    expect(sqlCode).not.toContain("JSON_SET(");
    expect(sqlCode).not.toContain("JSON_REMOVE(");
  });
});

describe("IKL406 价目迁移：视频改按秒", () => {
  it("★ 四个视频行都是 usage.seconds + 整数分母", () => {
    for (const model of VIDEO_MODELS) {
      const block = blockOf(model);
      expect(block).toContain("'baseUnit', 'usage.seconds'");
      expect(block).toContain("'unitDenominator', 1");
    }
  });

  it("★ token 口径的残留键整块清掉：usage.c / tokenEstimate / 百万分母", () => {
    for (const model of VIDEO_MODELS) {
      const block = blockOf(model);
      expect(block).not.toContain("usage.c");
      expect(block).not.toContain("tokenEstimate");
      expect(block).not.toContain("1000000");
      expect(block).not.toContain("1024");
    }
  });

  it("★ 价格表按「分辨率 × 是否含视频输入」双轴查表", () => {
    for (const model of VIDEO_MODELS) {
      expect(blockOf(model)).toContain("'by', JSON_ARRAY('resolution', 'video')");
    }
  });

  it("★ 每个视频行最后 ×2 的编辑模式倍率（万分比 20000）", () => {
    for (const model of VIDEO_MODELS) {
      expect(blockOf(model)).toContain("JSON_OBJECT('usage.videoEdit', 20000)");
    }
  });

  it("★ Seedance 2.0 逐档：480p 13/20、720p 27/49、1080p 68/110、4K 140/260", () => {
    const block = blockOf("doubao-seedance-2-0-260128");
    for (const entry of [
      "'resolution=480p|video=0', 13000",
      "'resolution=480p|video=1', 20000",
      "'resolution=720p|video=0', 27000",
      "'resolution=720p|video=1', 49000",
      "'resolution=1080p|video=0', 68000",
      "'resolution=1080p|video=1', 110000",
      "'resolution=4k|video=0', 140000",
      "'resolution=4k|video=1', 260000",
    ]) {
      expect(block).toContain(entry);
    }
  });

  it("★ Seedance 2.0 Fast 逐档：480p 10/16、720p 22/41", () => {
    const block = blockOf("doubao-seedance-2-0-fast-260128");
    for (const entry of [
      "'resolution=480p|video=0', 10000",
      "'resolution=480p|video=1', 16000",
      "'resolution=720p|video=0', 22000",
      "'resolution=720p|video=1', 41000",
    ]) {
      expect(block).toContain(entry);
    }
    expect(block).not.toContain("1080p");
    expect(block).not.toContain("4k");
  });

  it("★ Seedance 2.0 Mini 逐档：480p 8/9、720p 16/20", () => {
    const block = blockOf("doubao-seedance-2-0-mini-260615");
    for (const entry of [
      "'resolution=480p|video=0', 8000",
      "'resolution=480p|video=1', 9000",
      "'resolution=720p|video=0', 16000",
      "'resolution=720p|video=1', 20000",
    ]) {
      expect(block).toContain(entry);
    }
    expect(block).not.toContain("1080p");
    expect(block).not.toContain("4k");
  });

  it("★ Seedance 2.5 逐档：480p 20、720p 46、1080p 110（含与不含视频输入同价）", () => {
    const block = blockOf("doubao-seedance-2-5-260628");
    for (const entry of [
      "'resolution=480p|video=0', 20000",
      "'resolution=480p|video=1', 20000",
      "'resolution=720p|video=0', 46000",
      "'resolution=720p|video=1', 46000",
      "'resolution=1080p|video=0', 110000",
      "'resolution=1080p|video=1', 110000",
    ]) {
      expect(block).toContain(entry);
    }
    expect(block).not.toContain("4k");
  });

  it("★ 2.5 系把参考视频秒数按 100% 加进数量，其余三款不加", () => {
    expect(blockOf("doubao-seedance-2-5-260628")).toContain(
      "'dims', JSON_OBJECT('usage.referenceSeconds', 10000)",
    );
    for (const model of [
      "doubao-seedance-2-0-260128",
      "doubao-seedance-2-0-fast-260128",
      "doubao-seedance-2-0-mini-260615",
    ]) {
      expect(blockOf(model)).not.toContain("referenceSeconds");
      expect(blockOf(model)).not.toContain("'dims'");
    }
  });
});

describe("IKL406 价目迁移：音频改按字数", () => {
  it("★ 基准维度是 usage.characters，每字 10 mc", () => {
    const block = blockOf("seed-audio-1.0");
    expect(block).toContain("`capability_type` = 'audio'");
    expect(block).toContain("'baseUnit', 'usage.characters'");
    expect(block).toContain("'basePrice', JSON_OBJECT('kind', 'const', 'value', 10)");
    expect(block).toContain("'unitDenominator', 1");
    expect(block).toContain("'minCredits', 1");
  });

  it("★ 删掉 maxCredits —— 字数在提交时刻已知，不再需要上限兜底", () => {
    const block = blockOf("seed-audio-1.0");
    expect(block).not.toContain("maxCredits");
    expect(block).not.toContain("usage.seconds");
  });
});
