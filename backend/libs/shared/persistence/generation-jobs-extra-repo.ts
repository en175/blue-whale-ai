import type { Prisma } from "@prisma/client";

/** generation_jobs 的任务特有扩展位读写（IKJCOE）。
 *
 *  <p>表形态 (generation_job_id, extra_key, value_type, value_text) 见
 *  `backend/prisma/migrations/20260930150000_generation_job_extras/migration.sql`；
 *  extra_key **沿用被迁移列的原字段名**（video_stage / charge_state / …），
 *  故读方不用维护一层新旧名字映射。
 *
 *  <p>为什么是键值而不是继续给主表加列、以及加列的正当理由，见 ADR-0120。
 *  这里的规矩只有一条：**能进扩展位的就别进主表**。
 *
 *  <p>value_type 与 value_text 的编码约定（TS/Java 逐字对称，Java 侧见
 *  `GenerationJobExtraMapper`）：
 *  <ul>
 *    <li>{@code string} → 原样</li>
 *    <li>{@code number} → 十进制字符串；**上限**：超过 2^53 的值请传字符串
 *        （number 走 JS Number() / Java Long.parseLong，超出会丢精度）</li>
 *    <li>{@code boolean} → 'true' / 'false'</li>
 *    <li>{@code json} → JSON.stringify 的结果</li>
 *  </ul>
 */

export type ExtraType = "string" | "number" | "boolean" | "json";

/** 一个任务的扩展位（extra_key → 解码后的值）。缺键即缺省语义（如 canvas_card_state 缺键 = 'pending'）。 */
export type JobExtras = Map<string, unknown>;

/** 写入入参：值为 undefined（不动这个键）、null（删除这个键），其余按类型编码。 */
export type ExtraEntries = Record<string, unknown>;

/** 只需 generation_job_extras 委托——事务客户端与普通客户端都满足。 */
type ExtraDb = Pick<Prisma.TransactionClient, "generation_job_extras">;

export function encodeExtra(value: unknown): { value_type: ExtraType; value_text: string } {
  if (typeof value === "string") return { value_type: "string", value_text: value };
  if (typeof value === "boolean") {
    return { value_type: "boolean", value_text: value ? "true" : "false" };
  }
  if (typeof value === "bigint") {
    return { value_type: "number", value_text: value.toString() };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`generation_job_extras 不接受非有限数值：${String(value)}`);
    }
    return { value_type: "number", value_text: String(value) };
  }
  if (value !== null && typeof value === "object") {
    return { value_type: "json", value_text: JSON.stringify(value) };
  }
  throw new Error(`generation_job_extras 不接受的值类型：${typeof value}`);
}

export function decodeExtra(value_type: string, value_text: string): unknown {
  switch (value_type) {
    case "string":
      return value_text;
    case "number":
      return Number(value_text);
    case "boolean":
      return value_text === "true";
    case "json":
      return JSON.parse(value_text);
    default:
      // 未知类型不抛：老行/手改行不该让整个列表页 500。原样带出，由消费方兜底。
      return value_text;
  }
}

/**
 * 按 (job_id, extra_key) upsert 一批扩展位。
 *
 * <p>值为 `undefined` 的键**不动**（保持原样），值为 `null` 的键**删除**。
 * 这条「undefined = 不动」是必需的：Worker 侧「非空才写」的语义（原
 * `COALESCE(#{x}, col)`）靠它表达，否则一次终态写入会把先前记下的可信时间抹掉。
 *
 * <p>逐键 upsert（≤ 8 个键），不是 createMany：扩展位天然是「改几个键」，
 * 批量插入省不下一次往返，却要为每个键写一遍冲突处理。建立任务时的槽位同理。
 */
export async function setJobExtras(
  db: ExtraDb,
  jobId: bigint,
  entries: ExtraEntries,
): Promise<void> {
  for (const [extra_key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    if (value === null) {
      await db.generation_job_extras.deleteMany({
        where: { generation_job_id: jobId, extra_key },
      });
      continue;
    }
    const { value_type, value_text } = encodeExtra(value);
    await db.generation_job_extras.upsert({
      // Prisma 的复合唯一键在客户端按「字段名拼接」寻址（同 command_idempotency 的
      // project_id_operation_idempotency_key）；DB 侧索引名仍是 map 上的
      // uk_generation_job_extras__job_key。
      where: { generation_job_id_extra_key: { generation_job_id: jobId, extra_key } },
      create: { generation_job_id: jobId, extra_key, value_type, value_text },
      update: { value_type, value_text, gmt_modified: new Date() },
    });
  }
}

/**
 * 一批任务的全部扩展位；键是 job id **字符串**（与读路径的 `row.id.toString()` 对齐）。
 * 查不到扩展位的 job 不会出现在 Map 里（缺键 = 缺省语义，不是空对象）。
 */
export async function loadJobExtras(
  db: ExtraDb,
  jobIds: readonly string[],
): Promise<Map<string, JobExtras>> {
  const grouped = new Map<string, JobExtras>();
  if (jobIds.length === 0) return grouped;
  // 一次 in 查 + 内存分组，避免按行 N+1（口径同 job-repo 的 loadAssets）。
  const rows = await db.generation_job_extras.findMany({
    where: { generation_job_id: { in: [...new Set(jobIds)].map((id) => BigInt(id)) } },
    select: { generation_job_id: true, extra_key: true, value_type: true, value_text: true },
  });
  for (const row of rows) {
    const key = row.generation_job_id.toString();
    const bucket = grouped.get(key) ?? new Map<string, unknown>();
    bucket.set(row.extra_key, decodeExtra(row.value_type, row.value_text));
    grouped.set(key, bucket);
  }
  return grouped;
}

/** 单个任务的全部扩展位；无扩展位返回空 Map。 */
export async function loadJobExtrasOne(db: ExtraDb, jobId: string): Promise<JobExtras> {
  const rows = await db.generation_job_extras.findMany({
    where: { generation_job_id: BigInt(jobId) },
    select: { extra_key: true, value_type: true, value_text: true },
  });
  return new Map(
    rows.map((r) => [r.extra_key, decodeExtra(r.value_type, r.value_text)] as const),
  );
}

/** 从扩展位取字符串（缺键/类型不符给 null）。 */
export function extraString(extras: JobExtras | undefined, key: string): string | null {
  const v = extras?.get(key);
  return typeof v === "string" ? v : null;
}

/** 从扩展位取数值（缺键/类型不符给 null）。 */
export function extraNumber(extras: JobExtras | undefined, key: string): number | null {
  const v = extras?.get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
