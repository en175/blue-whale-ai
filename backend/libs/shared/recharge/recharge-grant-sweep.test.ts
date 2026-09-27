import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freshGrpcUrl,
  grpcActiveCatalog,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import { SYSTEM_SETTINGS_SECRET_ENV } from "@lib/shared/system-settings/index.js";
import {
  DEFAULT_GRANT_SWEEP_BATCH_SIZE,
  DEFAULT_GRANT_SWEEP_INTERVAL_MS,
  DEFAULT_GRANT_RETRY_WINDOW_MS,
  RechargeGrantReconcileTask,
} from "./recharge-grant-task.js";
import { GRANT_RETRY_WINDOW_MS, GRANT_STALE_AFTER_MS } from "./recharge-grant-sweeper.js";
import type { RechargeService } from "./recharge.service.js";
import { TIER, makeHttp, makeService } from "./recharge.testlib.js";
/* ============================================
 * 主动对账（#45）：没人轮询的单也要自愈。
 *
 * 到账的两条自愈路径都要「有人在」——网关通知只重投约 15 分钟，`getOrderStatus` 的补发要
 * 用户开着页面。用户关掉页面之后，一次发放失败的单就再没人碰。这里测的就是那条兜底：
 * 定时扫「钱到了、积分没发完」且已等太久的单，再推一次；仍失败就标 `grant_failed` 并**叫出声**。
 *
 * 另一条同样重要：重试**有上限**。一个永久坏掉的单不能每 5 分钟打一次 billing 打到天荒地老，
 * 超窗之后必须停下、且必须**被人看见**（见「超窗」那几条）。
 * ============================================ */

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

/** 把一笔订单造成「钱在 `agoMs` 毫秒前就到账了、积分一直没发出去」。 */
function backdateBy(
  orders: Map<string, Record<string, unknown>>,
  tradeNo: string,
  agoMs: number,
): void {
  const row = orders.get(tradeNo)!;
  row.status = "paid_pending";
  row.paid_pending_at = new Date(Date.now() - agoMs);
}

/** 默认：31 分钟前钱就到账了（够格重试，且远在 2 小时窗口内）。 */
function backdate(orders: Map<string, Record<string, unknown>>, tradeNo: string): void {
  backdateBy(orders, tradeNo, 31 * 60 * 1000);
}

/** 抓 console.warn 里那一条结构化日志（JSON 行）并解析。 */
function warnRecord(spy: { mock: { calls: unknown[][] } }, event: string) {
  const line = spy.mock.calls
    .map((call) => String(call[0]))
    .find((text) => text.includes(event));
  expect(line, `没有抓到 ${event} 这条 WARN`).toBeDefined();
  return JSON.parse(line as string) as Record<string, unknown>;
}

describe("RechargeService — 主动对账一轮", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("★ 卡了 31 分钟的待到账单：billing 恢复了，这一轮把它补发到账", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdate(orders, created.tradeNo);

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toEqual({
      scanned: 1,
      healed: 1,
      flagged: 0,
      stillFailing: 0,
      skipped: 0,
      abandoned: 0,
    });
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
  });

  it("★ 补发仍失败：标 grant_failed，并打一条查得到的结构化 WARN", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdate(orders, created.tradeNo);

    http.failNextGrants(1); // billing 还在抖
    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toEqual({
      scanned: 1,
      healed: 0,
      flagged: 1,
      stillFailing: 0,
      skipped: 0,
      abandoned: 0,
    });
    // 「到账异常」这个状态第一次真的被写进库
    expect(orders.get(created.tradeNo)?.status).toBe("grant_failed");

    // 光换个状态名没人看得见 —— 这条 WARN 是它唯一的出口，四个字段一个都不能少：
    // 拿 trade_no 去网关/订单表对，user_id 找人，金额对账，持有分钟数说明拖了多久
    const record = warnRecord(warnSpy, "recharge.grant_failed");
    expect(record.severity_text).toBe("warn");
    expect(record.trade_no).toBe(created.tradeNo);
    expect(record.user_id).toBe("9001");
    expect(record.amount_fen).toBe(10_000);
    expect(record.held_minutes as number).toBeGreaterThanOrEqual(30);
  });

  it("还没等够 30 分钟的单不动（正常发放的耗时远小于它）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    // 令牌还在有效期内、用户可能正扫着码 —— 这一步绝不能把它标成异常
    row.paid_pending_at = new Date(Date.now() - 5 * 60 * 1000);

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result.scanned).toBe(0);
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 已标 grant_failed 的单仍在扫描范围内：billing 恢复后它自己好起来", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdate(orders, created.tradeNo);

    http.failNextGrants(1);
    await service.sweepStaleGrants({ claimMs: 60_000 });
    expect(orders.get(created.tradeNo)?.status).toBe("grant_failed");

    // 下一轮（名额间隔已过）
    orders.get(created.tradeNo)!.last_query_at = null;
    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result.healed).toBe(1);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
  });

  it("★ 名额间隔内不重复处理同一笔（多副本下同一个单只由一个副本补发）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdate(orders, created.tradeNo);

    http.failNextGrants(2);
    await service.sweepStaleGrants({ claimMs: 5 * 60 * 1000 });
    const second = await service.sweepStaleGrants({ claimMs: 5 * 60 * 1000 });

    // 第二轮的取数仍会看到它（还是异常单），但名额已被人占着 → 跳过、不重复打 billing
    expect(second).toEqual({
      scanned: 1,
      healed: 0,
      flagged: 0,
      stillFailing: 0,
      skipped: 1,
      abandoned: 0,
    });
    expect(http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"))).toHaveLength(1);
  });

  it("★ 超过重试窗口：不再重试（billing 一次都不打），也不再进扫描范围", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 钱到账 3 小时前 —— 远在 2 小时窗口之外
    backdateBy(orders, created.tradeNo, 3 * 60 * 60 * 1000);

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toEqual({
      scanned: 0,
      healed: 0,
      flagged: 0,
      stillFailing: 0,
      skipped: 0,
      abandoned: 1,
    });
    // 关键：不是「重试失败」，是**不再重试** —— billing 那边一次调用都没有。
    // 一个永久坏掉的单曾经会每 5 分钟打一次 billing，永远不停
    expect(http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"))).toHaveLength(0);
    // ⚠️ 状态一个都不改：没有「放弃」这个状态，也不该为一个兜底动作新造一个
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");

    // 「停止重试」也要进心跳：告警与 WARN 两条路都能看到它
    const metric = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_sweep"));
    expect(JSON.parse(metric as string)).toMatchObject({
      event: "recharge.grant_sweep",
      scanned: 0,
      abandoned: 1,
    });
    expect(warnSpy).toBeDefined();
  });

  it("★ 超窗的单必须看得见：WARN 报条数 + 样本（tradeNo/userId/金额/已等多久）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdateBy(orders, created.tradeNo, 3 * 60 * 60 * 1000);

    await service.sweepStaleGrants({ claimMs: 60_000 });

    // 没有这条 WARN，这笔钱就是「悄悄地没人管了」—— 库里没有任何一列说它被放弃了，
    // 超窗的单看起来与「刚卡住」的单长得一模一样
    const record = warnRecord(warnSpy, "recharge.grant_retry_exhausted");
    expect(record.severity_text).toBe("warn");
    expect(record.count).toBe(1);
    expect(record.window_minutes).toBe(120);
    expect(record.sample_1_trade_no).toBe(created.tradeNo);
    expect(record.sample_1_user_id).toBe("9001");
    expect(record.sample_1_amount_fen).toBe(10_000);
    expect(record.sample_1_held_minutes as number).toBeGreaterThanOrEqual(180);
  });

  it("★ 窗口内外同时存在：内的照旧重试，外的不碰（超窗单不许占着队头）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const fresh = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const ancient = await service.createOrder({ userId: 9002, tierId: TIER.id });
    backdateBy(orders, fresh.tradeNo, 31 * 60 * 1000); // 窗口内
    backdateBy(orders, ancient.tradeNo, 5 * 60 * 60 * 1000); // 窗口外（更旧）
    // 取数按最旧优先：没有 SQL 侧的窗口上界，`ancient` 会永远排在 `fresh` 前面
    orders.get(ancient.tradeNo)!.gmt_create = new Date(Date.now() - 5 * 60 * 60 * 1000);

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toEqual({
      scanned: 1,
      healed: 1,
      flagged: 0,
      stillFailing: 0,
      skipped: 0,
      abandoned: 1,
    });
    expect(http.granted).toEqual([{ amount: 7500, bizId: fresh.tradeNo }]);
    expect(orders.get(ancient.tradeNo)?.status).toBe("paid_pending");
    expect(warnRecord(warnSpy, "recharge.grant_retry_exhausted").count).toBe(1);
  });

  it("★ 窗口边界之内（2 小时差 1 分钟）仍重试，之外（2 小时零 1 秒）不重试", async () => {
    makeHttp();
    grpcActiveCatalog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const inside = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const outside = await service.createOrder({ userId: 9002, tierId: TIER.id });
    backdateBy(orders, inside.tradeNo, GRANT_RETRY_WINDOW_MS - 60_000);
    backdateBy(orders, outside.tradeNo, GRANT_RETRY_WINDOW_MS + 1_000);

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result.scanned).toBe(1);
    expect(result.healed).toBe(1);
    expect(result.abandoned).toBe(1);
    expect(orders.get(inside.tradeNo)?.status).toBe("paid");
    expect(orders.get(outside.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 存量单没有 paid_pending_at：按**下单时刻**判窗口（同一套边界，不是两套口径）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = null; // 本列上线前的存量单
    row.gmt_create = new Date(Date.now() - 5 * 60 * 60 * 1000);

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result.scanned).toBe(0);
    expect(result.abandoned).toBe(1);
    expect(warnRecord(warnSpy, "recharge.grant_retry_exhausted").count).toBe(1);
  });

  it("★ 重试窗口可配：窗口内的单照旧重试（默认值不是写死的唯一取值）", async () => {
    makeHttp();
    grpcActiveCatalog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 40 分钟前到账：默认 2 小时窗口里，但把窗口调到 35 分钟就超窗了
    backdateBy(orders, created.tradeNo, 40 * 60 * 1000);

    const tuned = await service.sweepStaleGrants({
      claimMs: 60_000,
      retryWindowMs: 35 * 60 * 1000,
    });

    expect(tuned).toMatchObject({ scanned: 0, abandoned: 1 });
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");

    const byDefault = await service.sweepStaleGrants({ claimMs: 60_000 });
    expect(byDefault).toMatchObject({ scanned: 1, healed: 1, abandoned: 0 });
  });

  it("★ 超窗统计自己挂了：本轮补发照做，abandoned = -1（未知，不是 0）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders, prisma } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdate(orders, created.tradeNo); // 窗口内、够格重试
    vi.spyOn(prisma.recharge_orders, "count").mockRejectedValue(new Error("count 挂了"));

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    // 只影响可见性的统计挂了，不该把这一轮的钱也带走（否则白等 5 分钟才重试）
    expect(result).toMatchObject({ scanned: 1, healed: 1, abandoned: -1 });
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    // -1 与 0 的差别就在这里：一个是「没查出来」，一个是「确实没有」
    expect(
      warnSpy.mock.calls.map((c) => String(c[0])).some((t) => t.includes("已超窗单数的统计失败")),
    ).toBe(true);
  });

  it("逐笔兜住：一笔失败不能让同批其余单这轮白扫", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const older = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const newer = await service.createOrder({ userId: 9002, tierId: TIER.id });
    backdate(orders, older.tradeNo);
    backdate(orders, newer.tradeNo);
    // 取数按最旧优先：让 older 排在前面，先炸的那一笔就是它
    orders.get(older.tradeNo)!.gmt_create = new Date(Date.now() - 40 * 60 * 1000);

    http.failNextGrants(1);
    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toEqual({
      scanned: 2,
      healed: 1,
      flagged: 1,
      stillFailing: 0,
      skipped: 0,
      abandoned: 0,
    });
    expect(orders.get(older.tradeNo)?.status).toBe("grant_failed");
    expect(orders.get(newer.tradeNo)?.status).toBe("paid");
  });

  it("每轮一条心跳指标（定时任务最怕的是静默没跑）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { service } = await makeService();

    await service.sweepStaleGrants({ claimMs: 60_000 });

    const line = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_sweep"));
    expect(line).toBeDefined();
    expect(JSON.parse(line as string)).toMatchObject({
      event: "recharge.grant_sweep",
      scanned: 0,
      healed: 0,
    });
  });

  it("批量上限可覆盖，默认值是一个有界的数（一轮不无限扫）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    expect(DEFAULT_GRANT_SWEEP_BATCH_SIZE).toBeGreaterThan(0);

    const result = await service.sweepStaleGrants({ batchSize: 1, claimMs: 60_000 });
    expect(result.scanned).toBe(0);
  });
});

describe("RechargeGrantReconcileTask — 定时入口", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("RECHARGE_GRANT_SWEEP_INITIAL_DELAY_MS", "60000");
    vi.stubEnv("RECHARGE_GRANT_SWEEP_INTERVAL_MS", "300000");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const emptyResult = {
    scanned: 0,
    healed: 0,
    flagged: 0,
    stillFailing: 0,
    skipped: 0,
    abandoned: 0,
  };

  it("★ 首次延迟 1 分钟、此后每 5 分钟一轮（默认值写在常量里，就是这里跑的这两个数）", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const sweep = vi.fn(async () => emptyResult);
    const task = new RechargeGrantReconcileTask({ sweepStaleGrants: sweep } as unknown as RechargeService);
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    await task.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(sweep).toHaveBeenCalledTimes(2); // 停机之后不再跑
  });

  it("★ 一轮炸了不影响下一轮（异常必须吞掉，否则任务会被永久停掉）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sweep = vi
      .fn<(o: unknown) => Promise<typeof emptyResult>>()
      .mockRejectedValueOnce(new Error("billing 挂了"))
      .mockResolvedValue(emptyResult);
    const task = new RechargeGrantReconcileTask({ sweepStaleGrants: sweep } as unknown as RechargeService);
    task.onModuleInit();

    // 不抛出去：逃逸的异常会变成 uncaughtException（轻则进程退出，重则这个定时器
    // 从此每轮都在同一个地方炸，表现为「服务正常、只是再没有订单被补发」）
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(
      errorSpy.mock.calls.map((c) => String(c[0])).some((t) => t.includes("billing 挂了")),
    ).toBe(true);

    // 下一轮照跑，而且这次没炸
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(task).toBeDefined();

    await task.onModuleDestroy();
  });

  it("上一轮还没跑完就不开新的一轮（fixedDelay 语义，不堆积追赶）", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let release: (() => void) | null = null;
    const sweep = vi.fn(
      () =>
        new Promise<typeof emptyResult>((resolve) => {
          release = () => resolve(emptyResult);
        }),
    );
    const task = new RechargeGrantReconcileTask({ sweepStaleGrants: sweep } as unknown as RechargeService);
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    // 上一轮还挂着，两个周期过去了也没有开新的一轮
    await vi.advanceTimersByTimeAsync(600_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    release?.();
    await task.onModuleDestroy();
  });

  it("开关关掉：一轮都不跑（关它等于放弃「没人看也能自愈」这条保证，所以要吵一声）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("RECHARGE_GRANT_SWEEP_ENABLED", "false");
    const sweep = vi.fn(async () => emptyResult);
    const task = new RechargeGrantReconcileTask({ sweepStaleGrants: sweep } as unknown as RechargeService);
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(sweep).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.map((c) => String(c[0])).some((t) => t.includes("主动对账已关闭")),
    ).toBe(true);

    await task.onModuleDestroy();
  });

  it("环境变量配错（非数字 / 0 / 空串）→ 退回默认值，不拒启也不静默不跑", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("RECHARGE_GRANT_SWEEP_INITIAL_DELAY_MS", "abc");
    vi.stubEnv("RECHARGE_GRANT_SWEEP_INTERVAL_MS", "0");
    const sweep = vi.fn(async () => emptyResult);
    const task = new RechargeGrantReconcileTask({ sweepStaleGrants: sweep } as unknown as RechargeService);
    task.onModuleInit();

    // 兜底任务不该因为「配错一个数字」升级成「整个后端起不来」；
    // 也不该变成「看起来配了、实际一轮都不跑」—— 两个默认值照旧生效
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_GRANT_SWEEP_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(2);

    await task.onModuleDestroy();
  });

  it("★ 重试窗口默认 2 小时，并按这个值传给每一轮扫描", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const sweep = vi.fn(async () => emptyResult);
    const task = new RechargeGrantReconcileTask({ sweepStaleGrants: sweep } as unknown as RechargeService);
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(DEFAULT_GRANT_RETRY_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
    // 默认值只有一处来源（扫描器的常量），任务侧不能自己再写一个数
    expect(DEFAULT_GRANT_RETRY_WINDOW_MS).toBe(GRANT_RETRY_WINDOW_MS);
    expect(sweep).toHaveBeenCalledWith(
      expect.objectContaining({ retryWindowMs: DEFAULT_GRANT_RETRY_WINDOW_MS }),
    );

    await task.onModuleDestroy();
  });

  it("★ 窗口配得比判定阈值还短（交集为空 = 一轮都不重试）→ 退回默认值，并吵一声", async () => {
    // 这不是洁癖：`RECHARGE_GRANT_RETRY_WINDOW_MS` 配成 30 分钟，会让「够格重试」与
    // 「已经超窗」两个条件同时成立/同时不成立的那一支为空 —— 任务照跑、心跳照打、
    // 没有一行报错，就是再没有单被补发过。这种故障必须留痕。
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("RECHARGE_GRANT_RETRY_WINDOW_MS", String(GRANT_STALE_AFTER_MS));
    const sweep = vi.fn(async () => emptyResult);
    const task = new RechargeGrantReconcileTask({ sweepStaleGrants: sweep } as unknown as RechargeService);
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(sweep).toHaveBeenCalledWith(
      expect.objectContaining({ retryWindowMs: DEFAULT_GRANT_RETRY_WINDOW_MS }),
    );
    expect(
      warnSpy.mock.calls.map((c) => String(c[0])).some((t) => t.includes("重试窗口配置非法")),
    ).toBe(true);

    await task.onModuleDestroy();
  });
});
