import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freshGrpcUrl,
  grpcActiveCatalog,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import type { Logger } from "@lib/core/logging";
import { SYSTEM_SETTINGS_SECRET_ENV } from "@lib/shared/system-settings/index.js";
import {
  DEFAULT_GRANT_SWEEP_BATCH_SIZE,
  DEFAULT_GRANT_SWEEP_INTERVAL_MS,
  DEFAULT_GRANT_RETRY_WINDOW_MS,
  RechargeGrantReconcileTask,
} from "./recharge-grant-task.js";
import {
  GRANT_RETRY_WINDOW_MS,
  GRANT_STALE_AFTER_MS,
  resolveGrantRetryWindowMs,
} from "./recharge-grant-sweeper.js";
import type { RechargeService } from "./recharge.service.js";
import { TIER, makeHttp, makeService } from "./recharge.testlib.js";

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

function backdateBy(
  orders: Map<string, Record<string, unknown>>,
  tradeNo: string,
  agoMs: number,
): void {
  const row = orders.get(tradeNo)!;
  row.status = "paid_pending";
  row.paid_pending_at = new Date(Date.now() - agoMs);
}

function backdate(orders: Map<string, Record<string, unknown>>, tradeNo: string): void {
  backdateBy(orders, tradeNo, 31 * 60 * 1000);
}

function silentLogger(): Logger {
  return { warn: () => {} } as unknown as Logger;
}

function spyLogger(): { logger: Logger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  return { warn, logger: { warn } as unknown as Logger };
}

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

    http.failNextGrants(1);
    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toEqual({
      scanned: 1,
      healed: 0,
      flagged: 1,
      stillFailing: 0,
      skipped: 0,
      abandoned: 0,
    });
    expect(orders.get(created.tradeNo)?.status).toBe("grant_failed");

    const record = warnRecord(warnSpy, "recharge.grant_failed");
    expect(record.severity_text).toBe("warn");
    expect(record.trade_no).toBe(created.tradeNo);
    expect(record.user_id).toBe("9001");
    expect(record.amount_fen).toBe(10_000);
    expect(record.held_minutes as number).toBeGreaterThanOrEqual(30);
  });

  it("★ 用户在轮询（名额被占）时，异常单**仍然**被标 grant_failed 并 WARN 到（评审：两条路的名额互相饿死）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdate(orders, created.tradeNo);
    http.failNextGrants(10);

    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");

    const result = await service.sweepStaleGrants({ claimMs: DEFAULT_GRANT_SWEEP_INTERVAL_MS });

    expect(result).toMatchObject({ scanned: 1, healed: 0, flagged: 1, skipped: 0 });
    expect(orders.get(created.tradeNo)?.status).toBe("grant_failed");
    const record = warnRecord(warnSpy, "recharge.grant_failed");
    expect(record.trade_no).toBe(created.tradeNo);
    expect(record.user_id).toBe("9001");
    expect(record.amount_fen).toBe(10_000);
    expect(record.held_minutes as number).toBeGreaterThanOrEqual(30);
    expect(http.grantBodies).toHaveLength(1);
  });

  it("★ 名额被占时升级也**只叫一次**人：后续每轮都是 skipped，不再打 billing、不再 WARN（评审：两条路的名额互相饿死）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    backdate(orders, created.tradeNo);
    http.failNextGrants(10);

    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    for (let round = 0; round < 3; round += 1) {
      await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
      const swept = await service.sweepStaleGrants({
        claimMs: DEFAULT_GRANT_SWEEP_INTERVAL_MS,
      });
      expect(swept.flagged).toBe(round === 0 ? 1 : 0);
      expect(swept.skipped).toBe(round === 0 ? 0 : 1);
    }

    expect(orders.get(created.tradeNo)?.status).toBe("grant_failed");
    expect(
      warnSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((t) => t.includes("recharge.grant_failed")),
    ).toHaveLength(1);
    expect(http.grantBodies).toHaveLength(1);
  });

  it("还没等够 30 分钟的单不动（正常发放的耗时远小于它）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
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
    expect(http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"))).toHaveLength(0);
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");

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
    backdateBy(orders, fresh.tradeNo, 31 * 60 * 1000);
    backdateBy(orders, ancient.tradeNo, 5 * 60 * 60 * 1000);
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
    row.paid_pending_at = null;
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
    backdate(orders, created.tradeNo);
    vi.spyOn(prisma.recharge_orders, "count").mockRejectedValue(new Error("count 挂了"));

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toMatchObject({ scanned: 1, healed: 1, abandoned: -1 });
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
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
    const task = new RechargeGrantReconcileTask(
      { sweepStaleGrants: sweep } as unknown as RechargeService,
      DEFAULT_GRANT_RETRY_WINDOW_MS,
    );
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    await task.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("★ 一轮炸了不影响下一轮（异常必须吞掉，否则任务会被永久停掉）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sweep = vi
      .fn<(o: unknown) => Promise<typeof emptyResult>>()
      .mockRejectedValueOnce(new Error("billing 挂了"))
      .mockResolvedValue(emptyResult);
    const task = new RechargeGrantReconcileTask(
      { sweepStaleGrants: sweep } as unknown as RechargeService,
      DEFAULT_GRANT_RETRY_WINDOW_MS,
    );
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(
      errorSpy.mock.calls.map((c) => String(c[0])).some((t) => t.includes("billing 挂了")),
    ).toBe(true);

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
    const task = new RechargeGrantReconcileTask(
      { sweepStaleGrants: sweep } as unknown as RechargeService,
      DEFAULT_GRANT_RETRY_WINDOW_MS,
    );
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1);

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
    const task = new RechargeGrantReconcileTask(
      { sweepStaleGrants: sweep } as unknown as RechargeService,
      DEFAULT_GRANT_RETRY_WINDOW_MS,
    );
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
    const task = new RechargeGrantReconcileTask(
      { sweepStaleGrants: sweep } as unknown as RechargeService,
      DEFAULT_GRANT_RETRY_WINDOW_MS,
    );
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_GRANT_SWEEP_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(2);

    await task.onModuleDestroy();
  });

  it("★ 窗口由装配层注入、原样传给每一轮扫描（任务自己**不再**读 env）", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const injected = 45 * 60 * 1000;
    const sweep = vi.fn(async () => emptyResult);
    const task = new RechargeGrantReconcileTask(
      { sweepStaleGrants: sweep } as unknown as RechargeService,
      injected,
    );
    task.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(sweep).toHaveBeenCalledWith(expect.objectContaining({ retryWindowMs: injected }));

    await task.onModuleDestroy();
  });

  it("★ 默认窗口仍是 2 小时，且只有一处来源（扫描器的常量）", () => {
    expect(DEFAULT_GRANT_RETRY_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
    expect(DEFAULT_GRANT_RETRY_WINDOW_MS).toBe(GRANT_RETRY_WINDOW_MS);
    expect(resolveGrantRetryWindowMs(undefined, silentLogger())).toBe(
      DEFAULT_GRANT_RETRY_WINDOW_MS,
    );
  });
});

describe("resolveGrantRetryWindowMs — 重试窗口的唯一来源", () => {
  it("没配 / 空串 → 默认 2 小时，不吵（未配是正常路径）", () => {
    const { logger, warn } = spyLogger();
    expect(resolveGrantRetryWindowMs(undefined, logger)).toBe(GRANT_RETRY_WINDOW_MS);
    expect(resolveGrantRetryWindowMs("", logger)).toBe(GRANT_RETRY_WINDOW_MS);
    expect(resolveGrantRetryWindowMs("   ", logger)).toBe(GRANT_RETRY_WINDOW_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("★ 配了合法值就**真的**生效（运维调大窗口这条路通）", () => {
    const { logger } = spyLogger();
    const tuned = 45 * 60 * 1000;
    expect(resolveGrantRetryWindowMs(String(tuned), logger)).toBe(tuned);
    expect(resolveGrantRetryWindowMs(String(GRANT_STALE_AFTER_MS + 1), logger)).toBe(
      GRANT_STALE_AFTER_MS + 1,
    );
  });

  it("★ 配得比判定阈值还短（交集为空 = 一轮都不重试）→ 退回默认值，并吵一声", () => {
    const { logger, warn } = spyLogger();
    expect(resolveGrantRetryWindowMs(String(GRANT_STALE_AFTER_MS), logger)).toBe(
      GRANT_RETRY_WINDOW_MS,
    );
    expect(resolveGrantRetryWindowMs("abc", logger)).toBe(GRANT_RETRY_WINDOW_MS);
    expect(resolveGrantRetryWindowMs("0", logger)).toBe(GRANT_RETRY_WINDOW_MS);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0]?.[0])).toContain("重试窗口配置非法");
  });
});
