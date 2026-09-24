#!/usr/bin/env node
/**
 * 上游扣费对账（切换前一次性核对）。
 *
 * 用途：把「上游实际扣用户的」与「我们自己记账的」放一起比，看差多少。
 * 切换前跑，用来判断切换后用户的体感会不会变（贵了/便宜了），以及我们的
 * 计价口径有没有明显跑偏。
 *
 * ⚠️ **它回答的不是「我们算得对不对」。** 定价是我们自己定的——用户该付多少由我们
 * 的 catalog 说了算，与上游收我们多少无关。这个比对能回答的是「同一批任务，
 * 用户在新旧两套体系下各付多少」。别把它当成正确性验收。
 *
 * ── 两侧的数从哪来 ────────────────────────────────────────────────────────────
 *   上游：逐用户带他的 sk- 调 `GET /api/log/self/stat`（该用户在该窗口被扣的 quota 汇总）。
 *         路由见上游 `router/api-router.go`：`logRoute.GET("/self/stat", AccountTokenOrUserAuth(), ...)`。
 *         **按调用者身份取**，所以必须逐个用户查；全站视角的 `/api/log/stat` 要 AdminAuth。
 *         ⚠️ 这条只在 **sk- 还在**时可用（切换前）。断链之后要用统一 key 走 admin 接口。
 *   我们：`cost_reservations.actual_amount_fen`（已结算的实扣，单位**分**）。
 *
 * 两侧都归到**分**，所以不需要新造换算：
 *   quota → 分 走 `quotaToFen()`（`libs/core/generation-cost.ts`，产品确认 500,000 quota = $1、汇率 7.3）
 *   我们的记账本来就是分
 *
 * ⚠️ 单位陷阱（原文注释在 generation-cost.ts）：`quotaToFen` 是**记账口径**，
 *    与「展示积分」（quota/50,000）不是一回事，不要混用。
 *
 * ── 只读 ──────────────────────────────────────────────────────────────────────
 * 本脚本不写库、不改任何东西、不调任何写接口。失败了重跑即可。
 *
 * ── 用法（环境无关，不内置连接串，见 ADR-0064） ────────────────────────────────
 *   DATABASE_URL=mysql://... NEW_API_BASE_URL=https://... \
 *     node scripts/reconcile-upstream-quota.mjs --days 7
 *
 *   DATABASE_URL=... NEW_API_BASE_URL=... \
 *     node scripts/reconcile-upstream-quota.mjs \
 *       --from 2026-09-17T00:00:00+08:00 --to 2026-09-24T00:00:00+08:00
 *
 *   选项：
 *     --days N        最近 N 天（与 --from/--to 互斥；默认 1）
 *     --limit N       只查前 N 个用户（先小样本试跑，别一上来打全量）
 *     --json          输出纯 JSON，便于喂给别的工具
 *     --fail-over-bp N  任一用户差异超过 N 个万分比就退出码 1（默认不设阈值）
 *
 * 前置：`pnpm --dir backend build`（脚本从 backend/dist 引换算函数，与
 *      scripts/reconcile-cost-reservations.mjs 同一做法）。
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl) {
  fail("缺少 DATABASE_URL（见 ADR-0064：本地不内置测试站连接串，应急走隧道）");
}
const newApiBaseUrl = (process.env.NEW_API_BASE_URL ?? "").replace(/\/$/, "");
if (!newApiBaseUrl) {
  fail("缺少 NEW_API_BASE_URL");
}

let getPrismaClient;
let loadGenerationCostConfig;
let quotaToFen;

// ── 参数与环境（**排在重模块导入之前**：参数写错就该报参数错，
//     而不是被「模块没 build」挡在前面指错方向） ─────────────────────────────

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const JSON_MODE = process.argv.includes("--json");
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : null;
const FAIL_OVER_BP = argValue("--fail-over-bp") ? Number(argValue("--fail-over-bp")) : null;

function parseInstant(value, label) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label} 不是合法时间：${value}`);
  return parsed;
}

const fromArg = argValue("--from");
const toArg = argValue("--to");
const daysArg = argValue("--days");

let windowTo;
let windowFrom;
if (fromArg || toArg) {
  windowTo = toArg ? parseInstant(toArg, "--to") : new Date();
  windowFrom = fromArg ? parseInstant(fromArg, "--from") : new Date(windowTo.getTime() - 86_400_000);
} else {
  const days = daysArg ? Number(daysArg) : 1;
  if (!Number.isFinite(days) || days <= 0) fail(`--days 必须为正数：${daysArg}`);
  windowTo = new Date();
  windowFrom = new Date(windowTo.getTime() - days * 86_400_000);
}
if (windowFrom >= windowTo) fail("--from 必须早于 --to");

try {
  ({ getPrismaClient } = await import(
    pathToFileURL(resolve(scriptDir, "../backend/dist/libs/shared/persistence/db.js")).href
  ));
  ({ loadGenerationCostConfig, quotaToFen } = await import(
    pathToFileURL(resolve(scriptDir, "../backend/dist/libs/core/generation-cost.js")).href
  ));
} catch (error) {
  fail(
    `无法加载 backend/dist 下的换算模块（先跑 pnpm --dir backend build）：${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

const config = loadGenerationCostConfig();

// ── 取数 ────────────────────────────────────────────────────────────────────

const prisma = getPrismaClient(databaseUrl);

/** 上游：该用户窗口内被扣的 quota。返回 null = 这条查不到（sk- 失效 / 网络 / 上游报错）。 */
async function fetchUpstreamQuota(sk, errorSink) {
  const url = new URL(`${newApiBaseUrl}/api/log/self/stat`);
  url.searchParams.set("start_timestamp", String(Math.floor(windowFrom.getTime() / 1000)));
  url.searchParams.set("end_timestamp", String(Math.floor(windowTo.getTime() / 1000)));

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${sk}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      errorSink(`HTTP ${response.status}`);
      return null;
    }
    const body = await response.json();
    if (body?.success !== true) {
      errorSink(body?.message ?? "上游返回 success=false");
      return null;
    }
    const quota = Number(body?.data?.quota);
    if (!Number.isFinite(quota)) {
      errorSink("上游返回的 quota 不是数字");
      return null;
    }
    return quota;
  } catch (error) {
    errorSink(error instanceof Error ? error.message : String(error));
    return null;
  }
}

let rows;
try {
  // 我们的：按用户汇总实扣（分）。⚠️ actual 为 NULL 的行还没结算，
  // 它们不计入——半截数据混进来会让差异看起来像计价错误。
  const settlements = await prisma.cost_reservations.findMany({
    where: {
      is_delete: 0,
      actual_amount_fen: { not: null },
      gmt_create: { gte: windowFrom, lt: windowTo },
    },
    select: { user_id: true, actual_amount_fen: true },
  });

  const ourFenByUser = new Map();
  for (const row of settlements) {
    const key = row.user_id.toString();
    ourFenByUser.set(key, (ourFenByUser.get(key) ?? 0n) + BigInt(row.actual_amount_fen ?? 0));
  }

  // 执行凭证（sk-）。空凭证 / 已删用户跳过——他们的上游数无从查起。
  const credentials = await prisma.user_info.findMany({
    select: { user_id: true, provider_credential: true },
  });
  const skByUser = new Map(
    credentials
      .filter((c) => (c.provider_credential ?? "") !== "")
      .map((c) => [c.user_id.toString(), c.provider_credential]),
  );

  const userIds = [...ourFenByUser.keys()].sort(
    (a, b) => Number(ourFenByUser.get(b) - ourFenByUser.get(a)),
  );
  const selected = LIMIT == null ? userIds : userIds.slice(0, LIMIT);

  rows = [];
  let skippedNoSk = 0;
  let skippedCount = 0;

  for (const userId of selected) {
    const sk = skByUser.get(userId);
    if (!sk) {
      // 没有 sk- 就没法问上游。**明确计数而不是当 0**——否则这些用户会
      // 显示成「上游扣了 0 而我们扣了 N」，看起来像巨额计价错误。
      skippedNoSk++;
      continue;
    }

    const ourFen = ourFenByUser.get(userId) ?? 0n;
    const errors = [];
    const upstreamQuota = await fetchUpstreamQuota(sk, (message) => errors.push(message));

    if (upstreamQuota == null) {
      skippedCount++;
      rows.push({ userId, ourFen: ourFen.toString(), upstreamFen: null, diffBp: null, errors });
      continue;
    }

    const upstreamFen = quotaToFen(upstreamQuota, config);
    // 差异万分比。上游为 0 时比不了（除以 0），记 null 而不是编一个数。
    const diffBp =
      upstreamFen === 0n
        ? null
        : Number(((ourFen - upstreamFen) * 10_000n) / upstreamFen);

    rows.push({
      userId,
      ourFen: ourFen.toString(),
      upstreamQuota,
      upstreamFen: upstreamFen.toString(),
      diffBp,
      errors,
    });
  }

  const compared = rows.filter((r) => r.upstreamFen != null);
  const totalOurs = compared.reduce((sum, r) => sum + BigInt(r.ourFen), 0n);
  const totalTheirs = compared.reduce((sum, r) => sum + BigInt(r.upstreamFen), 0n);

  const report = {
    window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
    conversion: {
      quotaPerUnit: config.quotaPerUnit,
      usdExchangeRate: config.usdExchangeRate,
    },
    totals: {
      usersCompared: compared.length,
      usersSkippedNoCredential: skippedNoSk,
      usersSkippedUpstreamError: skippedCount,
      ourFen: totalOurs.toString(),
      upstreamFen: totalTheirs.toString(),
      diffBp:
        totalTheirs === 0n ? null : Number(((totalOurs - totalTheirs) * 10_000n) / totalTheirs),
    },
    rows,
  };

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (FAIL_OVER_BP != null) {
    const offenders = compared.filter((r) => r.diffBp != null && Math.abs(r.diffBp) > FAIL_OVER_BP);
    if (offenders.length > 0) {
      console.error(`\n✗ ${offenders.length} 个用户差异超过 ${FAIL_OVER_BP} 万分比`);
      process.exit(1);
    }
  }
} finally {
  await prisma.$disconnect?.();
}

function fenToYuan(fen) {
  return (Number(fen) / 100).toFixed(2);
}

function printReport(report) {
  const { window: w, totals: t, rows: list } = report;
  console.log(`上游扣费对账　窗口 ${w.from} → ${w.to}`);
  console.log(
    `换算：${report.conversion.quotaPerUnit} quota = $1，汇率 ${report.conversion.usdExchangeRate}`,
  );
  console.log("");
  console.log("userId            我们(元)      上游(元)      差异(bp)");
  console.log("─────────────────────────────────────────────────────");
  for (const row of list) {
    const ours = fenToYuan(row.ourFen).padStart(10);
    if (row.upstreamFen == null) {
      console.log(`${row.userId.padEnd(16)}${ours}      —            —   ${row.errors.join("; ")}`);
      continue;
    }
    const theirs = fenToYuan(row.upstreamFen).padStart(10);
    // ⚠️ padStart 要包住两种情况：只给数字补位会让「—」黏在上一列后面
    const diff = (row.diffBp == null ? "—" : String(row.diffBp)).padStart(8);
    console.log(`${row.userId.padEnd(16)}${ours}${theirs}${diff}`);
  }
  console.log("─────────────────────────────────────────────────────");
  console.log(
    `合计　我们 ${fenToYuan(t.ourFen)} 元　上游 ${fenToYuan(t.upstreamFen)} 元　` +
      `差异 ${t.diffBp == null ? "—" : t.diffBp} bp`,
  );
  console.log(
    `参与比对 ${t.usersCompared} 个用户；` +
      `缺 sk- 跳过 ${t.usersSkippedNoCredential} 个；上游查询失败 ${t.usersSkippedUpstreamError} 个`,
  );
  if (t.usersSkippedNoCredential > 0) {
    console.log(
      "⚠️ 缺 sk- 的用户**没有可比数据**，不要在合计里当成「上游 0」。",
    );
  }
  console.log("");
  console.log("提醒：本表回答的是「用户在新旧体系下各付多少」，不是「我们算得对不对」——");
  console.log("      定价由我们的 catalog 说了算，与上游收我们多少无关。");
}
