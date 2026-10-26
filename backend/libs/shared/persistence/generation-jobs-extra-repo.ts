import type { Prisma } from "@prisma/client";


export type ExtraType = "string" | "number" | "boolean" | "json";

export type JobExtras = Map<string, unknown>;

export type ExtraEntries = Record<string, unknown>;

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
      return value_text;
  }
}

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
      where: { generation_job_id_extra_key: { generation_job_id: jobId, extra_key } },
      create: { generation_job_id: jobId, extra_key, value_type, value_text },
      update: { value_type, value_text, gmt_modified: new Date() },
    });
  }
}

export async function loadJobExtras(
  db: ExtraDb,
  jobIds: readonly string[],
): Promise<Map<string, JobExtras>> {
  const grouped = new Map<string, JobExtras>();
  if (jobIds.length === 0) return grouped;
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

export async function loadJobExtrasOne(db: ExtraDb, jobId: string): Promise<JobExtras> {
  const rows = await db.generation_job_extras.findMany({
    where: { generation_job_id: BigInt(jobId) },
    select: { extra_key: true, value_type: true, value_text: true },
  });
  return new Map(
    rows.map((r) => [r.extra_key, decodeExtra(r.value_type, r.value_text)] as const),
  );
}

export function extraString(extras: JobExtras | undefined, key: string): string | null {
  const v = extras?.get(key);
  return typeof v === "string" ? v : null;
}

export function extraNumber(extras: JobExtras | undefined, key: string): number | null {
  const v = extras?.get(key);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
