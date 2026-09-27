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
  RechargeGrantReconcileTask,
} from "./recharge-grant-task.js";
import type { RechargeService } from "./recharge.service.js";
import { TIER, makeHttp, makeService } from "./recharge.testlib.js";
/* ============================================
 * 主动对账（#45）：没人轮询的单也要自愈。
 *
 * 到账的两条自愈路径都要「有人在」——网关通知只重投约 15 分钟，`getOrderStatus` 的补发要
 * 用户开着页面。用户关掉页面之后，一次发放失败的单就再没人碰。这里测的就是那条兜底：
 * 定时扫「钱到了、积分没发完」且已等太久的单，再推一次；仍失败就标 `grant_failed` 并**叫出声**。
 * ============================================ */

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

/** 把一笔订单造成「31 分钟前钱就到账了、积分一直没发出去」。 */
function backdate(orders: Map<string, Record<string, unknown>>, tradeNo: string): void {
  const row = orders.get(tradeNo)!;
  row.status = "paid_pending";
  row.paid_pending_at = new Date(Date.now() - 31 * 60 * 1000);
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
    });
    expect(http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"))).toHaveLength(1);
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
});
