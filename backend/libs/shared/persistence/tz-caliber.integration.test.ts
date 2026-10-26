















import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db.js";

const databaseUrl = process.env.IKHJ0Q_DATABASE_URL;
const TABLE = "tz_caliber_probe";
const DT = { scalarType: "datetime", dbType: "DATETIME", arity: "scalar" } as const;


const INSTANT = new Date(Date.UTC(2026, 8, 21, 6, 30, 34));
const BEIJING_LITERAL = "2026-09-21 14:30:34";

describe.skipIf(!databaseUrl)("时区口径：库里存北京时间（IKHJ0Q）", () => {
  let adapter: Awaited<ReturnType<PrismaMariaDb["connect"]>>;
  let raw: Pool;


  const literalOf = async (column: string): Promise<string> => {
    const rows = await raw.query(`SELECT CAST(${column} AS CHAR) AS lit FROM ${TABLE}`);
    return (rows[0] as { lit: string }).lit;
  };

  beforeAll(async () => {

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



    const res = await adapter.queryRaw({
      sql: `SELECT explicit_w FROM ${TABLE} ORDER BY id ASC LIMIT 1`,
      args: [],
      argTypes: [],
    });
    expect(new Date(res.rows[0][0] as string).getTime()).toBe(INSTANT.getTime());
  });

  it("DB 默认值与显式写入同钟——两处机制缺一不可的闸门", async () => {




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

    expect(secondsApart).toBeLessThan(5);
  });
});
