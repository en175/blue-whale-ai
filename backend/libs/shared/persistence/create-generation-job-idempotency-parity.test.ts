import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const createHandlerSource = readFileSync(
  new URL("../generation/handle-create-generation-job.ts", import.meta.url),
  "utf8",
);

describe("建任务幂等依赖的库契约（command_idempotency）", () => {
  it("基线建表带 (project_id, operation, idempotency_key) 唯一索引——并发同键的唯一闸", () => {
    expect(baselineSql).toContain("CREATE TABLE `command_idempotency`");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_command_idempotency`(`project_id`, `operation`, `idempotency_key`)",
    );
  });

  it("schema.prisma 是同一把复合唯一键（Prisma 按它生成 findUnique 的 where 形状）", () => {
    expect(schemaPrisma).toContain(
      '@@unique([project_id, operation, idempotency_key], map: "uk_command_idempotency")',
    );
  });

  it("建任务写入/回读的四列都在表里，且列宽撑得住（key 128 / 摘要 64）", () => {
    for (const column of [
      "`idempotency_key` VARCHAR(128) NOT NULL",
      "`request_hash` VARCHAR(64) NOT NULL",
      "`generation_job_id` BIGINT NULL",
      "`accepted_cursor` BIGINT NOT NULL",
    ]) {
      expect(baselineSql).toContain(column);
    }
  });

  it("入参校验的上限跟着列宽走（改列宽不改常量 = 让超长键在落库那一刻才炸）", () => {
    const columnWidth = /`idempotency_key` VARCHAR\((\d+)\)/.exec(baselineSql)?.[1];
    const handlerLimit =
      /IDEMPOTENCY_KEY_MAX_LENGTH = (\d+)/.exec(createHandlerSource)?.[1];
    expect(handlerLimit).toBe(columnWidth);
  });
});
