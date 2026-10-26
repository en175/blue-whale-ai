import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

type PrismaHolder = { prisma?: PrismaClient };
const globalForPrisma = globalThis as unknown as {
  __blueWhalePrisma?: PrismaHolder;
};
const holder: PrismaHolder = (globalForPrisma.__blueWhalePrisma ??= {});

export const DATABASE_TIMEZONE_PARAM = "timezone";

export function databaseTimezone(u: URL): string | undefined {
  const raw = u.searchParams.get(DATABASE_TIMEZONE_PARAM);
  if (raw === null || raw === "") return undefined;
  return raw.startsWith(" ") ? `+${raw.slice(1)}` : raw;
}

export function buildPoolConfig(databaseUrl: string) {
  const u = new URL(databaseUrl);
  const timezone = databaseTimezone(u);
  return {
    host: u.hostname,
    port: Number(u.port || "3306"),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    connectionLimit: 25,
    acquireTimeout: 30_000,
    connectTimeout: 30_000,
    ...(timezone === undefined ? {} : { timezone }),
  };
}

const REAL_ENV_DATABASE = /^blue_whale(_|$)/;

export function assertNotRealEnvironment(databaseUrl: string): void {
  if (process.env.VITEST !== "true") return;
  let name: string;
  try {
    name = new URL(databaseUrl).pathname.replace(/^\//, "");
  } catch {
    return;
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
