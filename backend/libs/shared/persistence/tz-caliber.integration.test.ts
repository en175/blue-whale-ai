// IKHJ0Q 时间口径回归（北京时间 +08:00）：真 adapter + 真 MySQL（IKHJ0Q_DATABASE_URL 门控）。
//
// 为什么必须有这一层：时区口径由**两处互不相干的机制**共同保证，而这个仓库此前没有任何测试
// 覆盖它们中的任何一个——
//   ① db.ts poolConfig 的 `timezone: "+08:00"`   → 管 DB 端求值（NOW() / DEFAULT CURRENT_TIMESTAMP）
//   ② patches/@prisma__adapter-mariadb@7.9.0.patch → 管 DATETIME 字面量的读写偏移
// 任一处被删掉，「同一行内 gmt_create 与 gmt_modified 差 8 小时」都不会让任何现有测试变红，
// 而表现是「接口时间看着没错、但库里一看就对不上」——最难排查的那类。
//
// 所以核心断言不是「patch 生效」，而是 **两条写入路径落在同一个钟**（最后一条）。
//
// 跑法（需本地 bw-mysql 或 Docker）：
//   IKHJ0Q_DATABASE_URL='mysql://root:localdev@127.0.0.1:13306/tz_caliber' \
//     pnpm exec vitest run backend/libs/shared/persistence/tz-caliber.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db.js";

const databaseUrl = process.env.IKHJ0Q_DATABASE_URL;
const TABLE = "tz_caliber_probe";
const DT = { scalarType: "datetime", dbType: "DATETIME", arity: "scalar" } as const;

/** 2026-09-21 14:30:34 北京时间 == 2026-09-21T06:30:34Z */
const INSTANT = new Date(Date.UTC(2026, 8, 21, 6, 30, 34));
const BEIJING_LITERAL = "2026-09-21 14:30:34";

describe.skipIf(!databaseUrl)("时区口径：库里存北京时间（IKHJ0Q）", () => {
  let adapter: Awaited<ReturnType<PrismaMariaDb["connect"]>>;
  let raw: Pool;

  /** 直接问 DB 要字面量，绕开一切 JS 中间层 */
  const literalOf = async (column: string): Promise<string> => {
    const rows = await raw.query(`SELECT CAST(${column} AS CHAR) AS lit FROM ${TABLE}`);
    return (rows[0] as { lit: string }).lit;
  };

  beforeAll(async () => {
    // 用生产同款配置构造——不在这里自己拼 poolConfig，否则 db.ts 里的 timezone 被删掉也测不出来。
    adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await adapter.executeRaw({ sql: `DROP TABLE IF EXISTS ${TABLE}`, args: [], argTypes: [] });
    await adapter.executeRaw({
      sql: `CREATE TABLE ${TABLE} (
              id INT PRIMARY KEY AUTO_INCREMENT,
              db_default DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
              explicit_w DATETIME(0) NULL
            )`,
      args: [],
      argTypes: [],
    });
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeRaw({ sql: `DROP TABLE IF EXISTS ${TABLE}`, args: [], argTypes: [] });
    await adapter.dispose();
  });

  it("会话时区被钉到 +08:00（db.ts 的 timezone 生效）", async () => {
    const rows = await raw.query("SELECT @@session.time_zone AS tz");
    expect((rows[0] as { tz: string }).tz).toBe("+08:00");
  });

  it("显式写入的 Date 落库为北京墙钟字面量（adapter patch 生效）", async () => {
    await adapter.executeRaw({
      sql: `INSERT INTO ${TABLE} (explicit_w) VALUES (?)`,
      args: [INSTANT],
      argTypes: [DT],
    });
    expect(await literalOf("explicit_w")).toBe(BEIJING_LITERAL);
  });

  it("读回的瞬时与写入的瞬时相等（往返恒等，JS 侧比较不失真）", async () => {
    // 显式 ORDER BY：现在表里只有一行，取 [0] 恰好对；但下一行测试会再插一条，
    // 一旦有人调整用例顺序或让本用例可单独重跑，不排序就会取错行而**静默地仍然通过**
    // （两条 explicit_w 的字面量类型相同，只差时刻）。排序把这件事钉死。
    const res = await adapter.queryRaw({
      sql: `SELECT explicit_w FROM ${TABLE} ORDER BY id ASC LIMIT 1`,
      args: [],
      argTypes: [],
    });
    expect(new Date(res.rows[0][0] as string).getTime()).toBe(INSTANT.getTime());
  });

  it("DB 默认值与显式写入同钟——两处机制缺一不可的闸门", async () => {
    // 本次改动的核心不变量：
    //   删掉 db.ts 的 timezone → db_default 走 UTC 会话，与 explicit_w 差 8 小时
    //   删掉 adapter patch     → explicit_w 走 UTC 字面量，与 db_default 差 8 小时
    // 两种半吊子状态都在这里变红。用「当前时刻」写入，两条路径才有可比性。
    await adapter.executeRaw({
      sql: `INSERT INTO ${TABLE} (explicit_w) VALUES (?)`,
      args: [new Date()],
      argTypes: [DT],
    });
    const rows = await raw.query(
      `SELECT CAST(db_default AS CHAR) AS d, CAST(explicit_w AS CHAR) AS e
       FROM ${TABLE} ORDER BY id DESC LIMIT 1`,
      { dateStrings: true },
    );
    const { d, e } = rows[0] as { d: string; e: string };
    const secondsApart = Math.abs(
      new Date(`${d.replace(" ", "T")}Z`).getTime() - new Date(`${e.replace(" ", "T")}Z`).getTime(),
    ) / 1000;
    // 两条路径在同一事务里取的时刻，正常差 0~1 秒；差 8 小时说明有一半没生效
    expect(secondsApart).toBeLessThan(5);
  });
});
