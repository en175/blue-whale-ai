import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

/** Prisma 7 运行时 client（mariadb driver adapter）。进程内单例。
 *  显式连接配置（解析 URL），acquire/connect 超时 30s，避免远端 DB 偶发 pool timeout。
 *  注意：不显式标注 mariadb.PoolConfig —— 其 stream 属性在 exactOptionalPropertyTypes 下不兼容。 */
let prisma: PrismaClient | undefined;

export function getPrismaClient(databaseUrl: string): PrismaClient {
  if (prisma) return prisma;
  const u = new URL(databaseUrl);
  const poolConfig = {
    host: u.hostname,
    port: Number(u.port || "3306"),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit: 5,
    acquireTimeout: 30_000,
    connectTimeout: 30_000,
  };
  prisma = new PrismaClient({ adapter: new PrismaMariaDb(poolConfig) });
  return prisma;
}

export type { PrismaClient } from "@prisma/client";
