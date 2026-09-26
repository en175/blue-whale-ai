import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

/** Prisma 7 运行时 client（mariadb driver adapter）。进程内单例。
 *  显式连接配置（解析 URL），acquire/connect 超时 30s，避免远端 DB 偶发 pool timeout。
 *  connectionLimit 抬到 25：交互式 $transaction 每个独占一条连接，原 5 条扛不住并发突发
 *  （连续提交图片生成时第 6 个起拿不到连接 → P2028「Unable to start a transaction」）。
 *  注意：池子是懒加载、按需长到上限；web+worker+api 多容器峰值合计需留意 MySQL
 *  max_connections（线上 151，wait_timeout 28800s 空闲连接回收慢），必要时同步抬 DB 上限。
 *  另：不显式标注 mariadb.PoolConfig —— 其 stream 属性在 exactOptionalPropertyTypes 下不兼容。
 *
 *  单例挂在 globalThis 而非模块级变量：Next.js dev（Turbopack）热重载会重新求值路由模块，
 *  模块级 `let` 会随之重置，导致每个重编译后的首个请求都重建连接池（远端 DB 握手 ~400ms+）。
 *  globalThis 跨模块求值存活，连接池得以复用，查询回到 ~100–250ms 热路径。
 *
 *  ── 时间口径：北京时间（+08:00）墙钟字面量 ───────────────────────────────
 *  全库时间列都是 DATETIME（无 TIMESTAMP），而 DATETIME 不做时区换算——存的就是字面量。
 *  要让 MySQL 客户端里看到北京时间，只能让写进去的字面量本身就是北京时间。两处缺一不可：
 *
 *   1. 下面的 `timezone: "+08:00"` —— 管【DB 端求值】：NOW()、CURRENT_TIMESTAMP(0)、
 *      以及 DDL 的 DEFAULT CURRENT_TIMESTAMP(0)。驱动据此发 SET time_zone='+08:00'。
 *   2. backend/patches/@prisma__adapter-mariadb@7.9.0.patch —— 管【字面量读写】：
 *      adapter 在每条查询上强制 dateStrings: true 并硬编码 UTC（读 `new Date(\`${v}Z\`)`、
 *      写 getUTC*），且无配置项。补丁把它改成按 +08:00 读写。
 *
 *  ⚠️ 只做一半会造成同一行内 8 小时撕裂：gmt_create 走 DDL 默认值（第 1 处生效）写北京，
 *     而 gmt_modified 走应用侧 new Date()（第 2 处生效）写 UTC。两处必须同 commit。
 *     backend/package.json 里该依赖已锁死 7.9.0——补丁按精确版本 key 匹配，用 ^ 范围
 *     会在上游升版时静默失配。
 *
 *  历史数据未迁移：切换到 +08:00 前写入的字面量仍是 UTC，读回会整体偏早 8 小时（既定口径）。 */
type PrismaHolder = { prisma?: PrismaClient };
const globalForPrisma = globalThis as unknown as {
  __blueWhalePrisma?: PrismaHolder;
};
const holder: PrismaHolder = (globalForPrisma.__blueWhalePrisma ??= {});

/** 从 DATABASE_URL 构造 mariadb PoolConfig。
 *  单独导出供测试复用——时区口径的回归测试必须跑在与生产完全相同的连接配置上，
 *  否则「有人把 timezone 删了」这类回归测不出来（见 tz-caliber.integration.test.ts）。 */
export function buildPoolConfig(databaseUrl: string) {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname,
    port: Number(u.port || "3306"),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit: 25,
    acquireTimeout: 30_000,
    connectTimeout: 30_000,
    // 会话时区 +08:00：让 NOW() / CURRENT_TIMESTAMP(0)（含 DDL DEFAULT CURRENT_TIMESTAMP）
    // 按北京时间求值。驱动据此在每条连接上发 SET time_zone='+08:00'。
    timezone: "+08:00",
  };
}

/** 真环境的库名（开发库 / 测试站 / 生产**同名**，所以按名字一条就够）。
 *  `blue_whale_*` 是历史遗留的变体（web / server / default）。 */
const REAL_ENV_DATABASE = /^blue_whale(_|$)/;

/**
 * 测试期的**库名闸门**：跑在 vitest 下、且连的是真环境的库 → 直接抛。
 *
 * <p>为什么需要：这批集成测试连**真 MySQL**，会给测试造数据、跑完还 `DELETE`。
 * 一旦那个 `*_DATABASE_URL` 门被指到开发库，就是一次**静默的数据清空**——
 * billing 侧为此丢过两次数据（那边已有三层护栏），而 backend 侧此前**没有任何检查**：
 * `vitest run backend` 时门控变量没设就整组 skip，设了就照连不误。
 *
 * <p>⚠️ **为什么是按名字拒绝、而不是「只放行测试库」的白名单**：
 * 白名单会在下一个合法的门出现时挡住人（本地那些库叫 `bw_gate_<工单号>`，
 * 但 `IKHJ0Q` 用的是 `tz_caliber`，还有若干 testcontainers 动态建名的）。
 * 我们要拦的东西只有一个 —— **那个真的库**。所以只拒它。
 *
 * <p>只在 `VITEST` 下生效，**不碰产品路径**：生产/测试站的进程里这个变量不是 `"true"`。
 *
 * <p>导出是为了让回归测试能直接调两个方向（拒绝 / 放行）——`getPrismaClient` 会把客户端
 * 缓存在全局 holder 上，用它测「放行」那条路会污染同进程里后面的用例。
 */
export function assertNotRealEnvironment(databaseUrl: string): void {
  if (process.env.VITEST !== "true") return;
  let name: string;
  try {
    name = new URL(databaseUrl).pathname.replace(/^\//, "");
  } catch {
    return; // 解析不出来就不猜（连不上自然会在别处炸）
  }
  if (REAL_ENV_DATABASE.test(name)) {
    throw new Error(
      `拒绝在测试里连接真环境的库「${name}」：这批集成测试会写数据、跑完还会 DELETE。` +
        `把它们指向专用测试库（本地约定 bw_gate_<工单号>，见各测试文件头部的跑法注释）。`,
    );
  }
}

export function getPrismaClient(databaseUrl: string): PrismaClient {
  assertNotRealEnvironment(databaseUrl);
  if (holder.prisma) return holder.prisma;
  holder.prisma = new PrismaClient({ adapter: new PrismaMariaDb(buildPoolConfig(databaseUrl)) });
  return holder.prisma;
}

export type { PrismaClient } from "@prisma/client";
