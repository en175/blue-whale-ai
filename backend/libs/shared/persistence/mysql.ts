import type { ReadinessProbe } from "@lib/core";
import { createPool, type Pool } from "mysql2/promise";

export interface MySqlConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

export function loadMySqlConfig(env: NodeJS.ProcessEnv = process.env): MySqlConfig {
  return {
    host: env.MYSQL_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.MYSQL_PORT ?? "3306", 10),
    database: env.MYSQL_DATABASE ?? "blue_whale",
    user: env.MYSQL_USER ?? "root",
    password: env.MYSQL_PASSWORD ?? "blue_whale",
  };
}

export function createMySqlPool(config = loadMySqlConfig()): Pool {
  return createPool({
    ...config,
    connectionLimit: 4,
    // 与 Prisma 路径同口径（北京时间）：mysql2 的 timezone 同时参与 DATETIME 的解析与格式化。
    timezone: "+08:00",
  });
}

export function createMySqlReadinessProbe(pool: Pool): ReadinessProbe {
  return {
    name: "mysql",
    async check() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
  };
}
