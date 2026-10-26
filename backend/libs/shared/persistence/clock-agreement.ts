import type { PrismaClient } from "@prisma/client";

const MAX_SKEW_SECONDS = 60;

export async function assertClockAgreement(prisma: PrismaClient): Promise<void> {
  let rows: Array<{ skew: bigint | number }>;
  try {
    rows = await prisma.$queryRaw<Array<{ skew: bigint | number }>>`
      SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS skew
    `;
  } catch (error) {
    throw new Error(
      `数据库不可达，无法校验时钟口径：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const databaseSkew = Number(rows[0]?.skew ?? 0);
  const processSkew = -new Date().getTimezoneOffset() * 60;
  if (Math.abs(databaseSkew - processSkew) <= MAX_SKEW_SECONDS) return;

  throw new Error(
    `进程时区与数据库会话时区不一致：进程 ${processSkew / 3600} 小时、库 ${databaseSkew / 3600} 小时。` +
      `这两个值都决定「时间按哪套钟解释」，必须同时配成同一时区 —— ` +
      `容器 TZ 与 DATABASE_URL 的 timezone 查询参数。`,
  );
}
