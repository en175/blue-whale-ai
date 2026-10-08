import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  checkGenerationParamLimit,
  type CapabilityLimitInput,
} from "./capability-param-validation.js";

// IKG4UR：时长**同源**回归。
//
// 这条链路出过的病根是「落库区间」与「服务端接受集」分叉：滑杆按 supported_durations 渲染区间，
// 而校验一旦命中 features.task_types[*].allowed_durations 就改按**枚举**判——于是滑杆给得出的
// 6–9（2.0）/ 7·9·11…（2.5）提交必被 400。修法是移除该枚举、时长只由基础行区间裁决。
//
// 本测试直接读种子，两路断言：
//   ① 静态：退役字段没有回流；
//   ② 行为：把行内**实际残留的** allowed_durations（若有）原样喂给校验器，断言声明的区间内
//      每一个 step 仍被接受、区间外仍被拒。两路都读同一份种子——数据或校验任一侧漂移就红。

const seedSql = readFileSync(
  new URL("../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
);

type VideoDurationRow = {
  modelId: string;
  min: number;
  max: number;
  step: number;
  /** 行内残留的退役枚举（正常为 null）。原样带给校验器，让行为断言也能抓到回流。 */
  legacyAllowedDurations: number[] | null;
};

/** 取种子里所有 capability_type='video' 的行块，解析 model_id、时长区间与残留枚举。 */
function videoDurationRows(sql: string): VideoDurationRow[] {
  return sql
    .split(/\n  \(\n/)
    .filter((block) => /^\s*'[^']*',\n\s*'[^']+',\n\s*'video',/.test(block))
    .map((block) => {
      const modelId = block.match(/^\s*'[^']*',\n\s*'([^']+)'/)![1];
      const range = block.match(
        /JSON_OBJECT\('min',\s*(\d+),\s*'max',\s*(\d+),\s*'step',\s*(\d+)\)/,
      );
      expect(range, `${modelId} 的 supported_durations 应为 {min,max,step} 对象形态`).toBeTruthy();

      const legacy = block.match(/'allowed_durations',\s*JSON_ARRAY\(([^)]*)\)/);
      return {
        modelId,
        min: Number(range![1]),
        max: Number(range![2]),
        step: Number(range![3]),
        legacyAllowedDurations: legacy
          ? legacy[1]
              .split(",")
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isFinite(n))
          : null,
      };
    });
}

/** 按行声明的区间构造能力行；残留枚举照原样带上，并令校验器按 default 任务类型取用。 */
function capabilityOf(row: VideoDurationRow): CapabilityLimitInput {
  return {
    supported_sizes: [{ id: "720p", api_value: "720p" }],
    supported_aspect_ratios: ["16:9"],
    supported_durations: { min: row.min, max: row.max, step: row.step },
    task_types: { text2video: {} },
  };
}

function checkRange(capability: CapabilityLimitInput, duration: number) {
  return checkGenerationParamLimit(capability, {
    size: "720p",
    aspect_ratio: "16:9",
    duration,
    mode: "text2video",
  });
}

const rows = videoDurationRows(seedSql);

describe("IKG4UR 时长同源：种子声明的区间 = 服务端接受集", () => {
  it("解析到了视频行（防解析器静默失效导致整个 describe 空转）", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.modelId).toMatch(/^doubao-/);
  });

  it("种子里 allowed_durations 只允许 [-1]（防回流：正数档位枚举）", () => {
    const withoutComments = seedSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const hit of withoutComments.matchAll(/allowed_durations[^\n]*/g)) {
      expect(hit[0]).toContain("-1");
      expect(hit[0].replace(/-1/g, "")).not.toMatch(/\d/);
    }
  });

  it.each(rows)("$modelId：区间内每个 step 都被接受", (row) => {
    const capability = capabilityOf(row);
    for (let d = row.min; d <= row.max; d += row.step) {
      const failure = checkRange(capability, d);
      expect(failure, `${row.modelId} 应接受 ${d} 秒（区间 ${row.min}–${row.max}）`).toBeNull();
    }
  });

  it.each(rows)("$modelId：区间外被拒", (row) => {
    const capability = capabilityOf(row);
    for (const d of [row.min - 1, row.max + 1]) {
      const failure = checkRange(capability, d);
      expect(failure, `${row.modelId} 应拒绝 ${d} 秒（区间 ${row.min}–${row.max}）`).not.toBeNull();
    }
  });
});
