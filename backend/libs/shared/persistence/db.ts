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
 *  globalThis 跨模块求值存活，连接池得以复用，查询回到 ~100–250ms 热路径。 */
type PrismaHolder = { prisma?: PrismaClient };
const globalForPrisma = globalThis as unknown as {
  __blueWhalePrisma?: PrismaHolder;
};
const holder: PrismaHolder = (globalForPrisma.__blueWhalePrisma ??= {});

export function getPrismaClient(databaseUrl: string): PrismaClient {
  if (holder.prisma) return holder.prisma;
  const u = new URL(databaseUrl);
  const poolConfig = {
    host: u.hostname,
    port: Number(u.port || "3306"),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit: 25,
    acquireTimeout: 30_000,
    connectTimeout: 30_000,
  };
  holder.prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolConfig) });
  return holder.prisma;
}

export type { PrismaClient } from "@prisma/client";
