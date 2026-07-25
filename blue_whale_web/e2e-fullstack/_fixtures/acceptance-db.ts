/**
 * 全栈验收数据库事实 fixture（IK2BDN T6.3）
 *
 * ContentReview / CostReservation / AuditRecord / ProviderTask 四张治理表
 * 没有任何 HTTP 查询出口（见 BottomDockGenerationJobIT 的 JdbcTemplate 断言），
 * 全栈验收只能经 `docker exec bw-acc-mysql` 直连验收栈 MySQL 读取。
 * 验收栈 mysql 不发布宿主端口（docker-compose.acceptance.yml `ports: !reset []`），
 * 本 fixture 只读、只跑 SELECT，容器/凭据可用环境变量覆盖以适配并行验收栈。
 *
 * 注意：本文件只在 Node（Playwright runner / vitest）侧执行，不进浏览器 bundle。
 */
import { execFileSync } from "node:child_process";

const MYSQL_CONTAINER =
  process.env.BW_ACCEPTANCE_MYSQL_CONTAINER ?? "bw-acc-mysql";
const MYSQL_USER = process.env.BW_ACCEPTANCE_MYSQL_USER ?? "root";
const MYSQL_PASSWORD = process.env.BW_ACCEPTANCE_MYSQL_PASSWORD ?? "blue_whale";
const MYSQL_DATABASE = process.env.BW_ACCEPTANCE_MYSQL_DATABASE ?? "blue_whale";

/** 解析 mysql -N -B（batch，制表符分隔）输出为行数组。 */
export function parseTsv(output: string): string[][] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}

/** 只读查询验收栈 MySQL，返回行数组（每行为列值数组）。 */
export function queryAcceptanceDb(sql: string): string[][] {
  const stdout = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      MYSQL_CONTAINER,
      "mysql",
      `-u${MYSQL_USER}`,
      `-p${MYSQL_PASSWORD}`,
      MYSQL_DATABASE,
      "-N",
      "-B",
      "-e",
      sql,
    ],
    { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
  return parseTsv(stdout);
}

/** 单行单列查询；无行返回 null。 */
export function queryAcceptanceDbScalar(sql: string): string | null {
  const rows = queryAcceptanceDb(sql);
  return rows.length > 0 && rows[0].length > 0 ? rows[0][0] : null;
}

/** 单行单列计数查询。 */
export function queryAcceptanceDbCount(sql: string): number {
  const value = queryAcceptanceDbScalar(sql);
  return value === null ? 0 : Number(value);
}
