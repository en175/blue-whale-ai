import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AdminListTransactionsResponseSchema,
  AdminTransactionItemSchema,
} from "../../contracts/gen/billing/v1/billing_pb.js";
import {
  freshGrpcUrl,
  grpcActiveCatalog,
  grpcAdminService,
  grpcStubTransport,
} from "./billing-admin-grpc-stub.testlib.js";
import {
  BillingAdminConfigError,
  BillingAdminError,
  CatalogRejectedError,
  DiscountNotFoundError,
  DiscountRejectedError,
  billingAdminUrl,
  createMemberDiscount,
  createPromotion,
  deleteMemberDiscount,
  fetchActiveCatalog,
  fetchCreditsPerYuan,
  grantCredits,
  listAdminTransactions,
  listMemberDiscounts,
  listPromotions,
  publishCatalog,
  updateMemberDiscount,
  updatePromotion,
} from "./billing-admin-client.js";

const ENV = { BILLING_ADMIN_URL: "http://billing.internal:4003/" };

function stub(body: unknown, status = 200) {
  const calls: { url: string; body: unknown; raw: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const raw = init?.body ? String(init.body) : "";
      calls.push({
        url: String(url),
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        raw,
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

/* ---------- gRPC 侧：内存 transport ---------- */

// 只做转发，「装哪个 router」在 billing-admin-grpc-stub.testlib.ts 里（三个测试文件同一套）。
vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

/** 一个完整的活动写请求体：PUT 是整条覆盖，每一列都要给。 */
const PROMOTION_INPUT = {
  code: "night-70",
  name: "夜间 7 折",
  discountBp: 7000,
  modelIds: ["*"],
  taskTypes: null,
  tierScope: null,
  startAt: "2026-10-01T00:00",
  endAt: "2026-11-01T00:00",
  dailyTimeStart: null,
  dailyTimeEnd: null,
  daysOfWeek: null,
  tz: "Asia/Shanghai",
  status: "enabled",
  priority: 0,
};

describe("billing-admin-client", () => {
  beforeEach(() => {
    vi.stubEnv("BILLING_ADMIN_URL", ENV.BILLING_ADMIN_URL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("管理端地址未配置 → 直接抛（发放配不出地址时不许静默跳过）", () => {
    expect(() => billingAdminUrl({})).toThrow(BillingAdminConfigError);
    expect(billingAdminUrl(ENV)).toBe("http://billing.internal:4003");
  });

  it("换算率从定价目录读，不是代码常量", async () => {
    freshGrpcUrl();
    grpcActiveCatalog({ version: 3, creditsPerYuan: 15 });
    await expect(fetchCreditsPerYuan()).resolves.toBe(15);
  });

  it("没有生效目录（version=-1 / creditsPerYuan=-1）→ 抛，不回退默认值", async () => {
    freshGrpcUrl();
    grpcActiveCatalog({ version: -1, creditsPerYuan: -1 });
    await expect(fetchCreditsPerYuan()).rejects.toThrow(BillingAdminConfigError);
  });

  it("发放：请求体用我们自己的交易单号做幂等键，source 是 purchased", async () => {
    const calls = stub({ lotId: 77 });
    const result = await grantCredits({ userId: 9001, credits: 1500, bizId: "RC1" });

    expect(calls[0]?.url).toBe("http://billing.internal:4003/admin/credits/grants");
    expect(calls[0]?.body).toEqual({
      userId: 9001,
      source: "purchased",
      amount: 1500,
      bizId: "RC1",
      bizType: "recharge",
    });
    expect(result).toEqual({ lotId: "77", duplicated: false, existingBizId: null });
  });

  it("重复发放（billing 409）→ 当成「已经发过了」的正常结果，不当成故障", async () => {
    stub({ code: "DUPLICATE" }, 409);
    await expect(grantCredits({ userId: 1, credits: 1500, bizId: "RC1" })).resolves.toEqual({
      lotId: "",
      duplicated: true,
      // 老版本 billing 不带这个字段 → null = 「拿不到归属」，不是「没有归属」
      existingBizId: null,
    });
  });

  it("★ 409 带上 existingBizId：调用方靠它分辨「我自己发过」与「别人先占了」", async () => {
    stub({ code: "DUPLICATE", existingBizId: "RC-FIRST" }, 409);

    const result = await grantCredits({ userId: 1, credits: 1000, bizId: "RC-SECOND" });

    // 两者在 wire 上都是 409、duplicated 都是 true，差别只在这个字段。
    // 丢了它，调用方就只能把两种情况混成一个结论 —— 而它们的业务含义正好相反。
    expect(result).toEqual({ lotId: "", duplicated: true, existingBizId: "RC-FIRST" });
  });

  it("其它错误码 → 抛错（调用方要让网关重投）", async () => {
    stub({ code: "INTERNAL" }, 500);
    await expect(grantCredits({ userId: 1, credits: 1, bizId: "RC1" })).rejects.toThrow(
      BillingAdminError,
    );
  });

  /* ---------- 定价目录：读 / 发布 ---------- */

  it("读当前目录：连文档原文一起带回来（管理端页面的编辑起点）", async () => {
    freshGrpcUrl();
    grpcActiveCatalog({
      version: 3,
      documentHash: "abc",
      creditsPerYuan: 15,
      documentJson: '{"schemaVersion":1}',
    });

    // 逐字段对：proto 侧的名字（version / documentJson / documentHash / creditsPerYuan）
    // 与这里返回的 HTTP 时代命名（catalogVersion / document）**不一样**，
    // 映射错了管理端就会拿到一个「看着对但读不到」的目录
    await expect(fetchActiveCatalog()).resolves.toEqual({
      catalogVersion: 3,
      documentHash: "abc",
      creditsPerYuan: 15,
      document: '{"schemaVersion":1}',
    });
  });

  it("读当前目录：没有生效版本时不抛（管理端要能显示「还没发布过」并从零建一份）", async () => {
    freshGrpcUrl();
    grpcActiveCatalog({ version: -1, creditsPerYuan: -1 });

    await expect(fetchActiveCatalog()).resolves.toEqual({
      catalogVersion: -1,
      documentHash: "",
      creditsPerYuan: -1,
      document: "",
    });
    // 同一份数据，充值那条路径仍然必须抛 —— 换算率取不到就不该给用户报价
    await expect(fetchCreditsPerYuan()).rejects.toThrow(BillingAdminConfigError);
  });

  /* ---------- 流水：presence 与全站哨兵 ---------- */

  it("流水：预扣额没设 → null（**不是 0，也不是 undefined**）", async () => {
    // ⚠️ 这条钉的是 2026-09-26 那次整页白屏的根：
    //    proto3 `optional` 没设 ⇒ protobuf-es 给 `undefined`，而本文件的契约是 `null`。
    //    不收敛成一种形态，前端 `!== null` 就会把「没有预扣」当成「有值」渲染。
    //    `0n` 与「没设」在**这条路上**必须能分开：0 是「冻了 0 分」。
    freshGrpcUrl();
    grpcAdminService({
      adminListTransactions: () =>
        create(AdminListTransactionsResponseSchema, {
          items: [
            // 发放行：**不设** reservedCredits
            create(AdminTransactionItemSchema, {
              id: "lot:1",
              userId: 7n,
              type: "gift",
              direction: "in",
              title: "运营赠送",
              amount: 100n,
              status: "done",
              createdAt: "2026-09-26T10:00:00+08:00",
            }),
            // 消费行：设了预扣额
            create(AdminTransactionItemSchema, {
              id: "res:9",
              userId: 7n,
              type: "consume",
              direction: "out",
              title: "生成消费",
              amount: 30n,
              reservedCredits: 100n,
              status: "done",
              createdAt: "2026-09-26T10:01:00+08:00",
            }),
          ],
        }),
    });

    const page = await listAdminTransactions({ pageSize: 50 });

    expect(page.items[0]?.reservedCredits).toBeNull();
    expect(page.items[1]?.reservedCredits).toBe(100);
  });

  it("流水：生成任务 id 没设 → null；设了 → **字符串**，且大 id 不丢精度", async () => {
    // ⚠️ 这一列是 join key（拿它回自己库查任务、取提示词），所以**不能过 `Number()`**：
    //    int64 在 protobuf-es 里是 bigint，超过 2^53 时 Number 会**静默**丢精度——
    //    查不到还好，查到**另一个任务**就是把别人的提示词给运营看了。
    //    下面这个 id 特意取在 2^53 之上。
    const HUGE_JOB_ID = 9_007_199_254_740_993n;
    freshGrpcUrl();
    grpcAdminService({
      adminListTransactions: () =>
        create(AdminListTransactionsResponseSchema, {
          items: [
            // 发放行：**不设** generationJobId（presence 缺席，不是「任务 0」）
            create(AdminTransactionItemSchema, {
              id: "lot:1",
              userId: 7n,
              type: "gift",
              direction: "in",
              title: "运营赠送",
              amount: 100n,
              status: "done",
              createdAt: "2026-09-26T10:00:00+08:00",
            }),
            // 消费行：设了任务 id
            create(AdminTransactionItemSchema, {
              id: "res:9",
              userId: 7n,
              type: "consume",
              direction: "out",
              title: "生成消费",
              amount: 30n,
              generationJobId: HUGE_JOB_ID,
              status: "done",
              createdAt: "2026-09-26T10:01:00+08:00",
            }),
          ],
        }),
    });

    const page = await listAdminTransactions({ pageSize: 50 });

    expect(page.items[0]?.generationJobId).toBeNull();
    expect(page.items[1]?.generationJobId).toBe("9007199254740993");
    // 走 Number 会得到 9007199254740992 —— 少 1，且**不报错**
    expect(page.items[1]?.generationJobId).not.toBe("9007199254740992");
  });

  it("流水：userId 不传 = **全站**（发的是 0 这个哨兵值，不是「用户 0」）", async () => {
    freshGrpcUrl();
    const seen: bigint[] = [];
    grpcAdminService({
      adminListTransactions: (req) => {
        seen.push(req.userId);
        return create(AdminListTransactionsResponseSchema, {});
      },
    });

    await listAdminTransactions({});
    await listAdminTransactions({ userId: 42 });

    // 用户 id 从 1 起，0 占用不到 —— 服务端据此判断「不过滤」
    expect(seen).toEqual([0n, 42n]);
  });

  it("发布：请求体就是文档文本本身，不包一层 {document: ...}", async () => {
    const calls = stub({
      catalogVersion: 4,
      documentHash: "def",
      creditsPerYuan: 15,
    });

    const document = '{"schemaVersion":1,"creditsPerYuan":15}';
    await expect(
      publishCatalog({ document, publishedBy: "42", note: "改价" }),
    ).resolves.toEqual({
      catalogVersion: 4,
      documentHash: "def",
      creditsPerYuan: 15,
    });

    expect(calls[0]?.url).toBe(
      "http://billing.internal:4003/admin/catalogs?publishedBy=42&note=%E6%94%B9%E4%BB%B7",
    );
    // 逐字节等于原文：中间没有任何人重新序列化它（包一层就会多一次转义再解析）
    expect(calls[0]?.raw).toBe(document);
  });

  it("发布：文档被拒（400）→ 抛 CatalogRejectedError 并带上 billing 的原话", async () => {
    stub({ code: "INVALID_ARGUMENT", message: "baseUnit 指向不存在的维度 usage.x" }, 400);

    // 这是「改文档」而不是「等服务恢复」，所以类型必须与 BillingAdminError 分开：
    // 否则调用方只能靠状态码猜处置方向
    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(CatalogRejectedError);
    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(/usage\.x/);
  });

  it("发布：其它非 2xx → BillingAdminError（可重试的一类）", async () => {
    stub({ message: "网关超时" }, 502);

    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(BillingAdminError);
  });

  /* ---------- 折扣（会员折扣 / 营销活动） ---------- */

  it("会员折扣：列 / 建 / 改 / 删各打对端点", async () => {
    const listCalls = stub([{ id: 1, tier: "pro", discountBp: 9000 }]);
    await listMemberDiscounts({ tier: "pro", status: "enabled" });
    expect(listCalls[0]?.url).toBe(
      "http://billing.internal:4003/admin/member-discounts?tier=pro&status=enabled",
    );

    // ⚠️ 省略过滤条件时**不带查询串**：带上 `tier=` 会让 billing 收到一个空值，
    //    而「不过滤」与「过滤一个空等级」是两件事
    const bareCalls = stub([]);
    await listMemberDiscounts();
    expect(bareCalls[0]?.url).toBe("http://billing.internal:4003/admin/member-discounts");

    const writeCalls = stub({ id: 7 });
    await createMemberDiscount({
      tier: "pro",
      modelPattern: "*",
      taskPattern: "*",
      discountBp: 9000,
      priority: 0,
      status: "enabled",
    });
    expect(writeCalls[0]?.url).toBe("http://billing.internal:4003/admin/member-discounts");
    expect(writeCalls[0]?.body).toMatchObject({ tier: "pro", discountBp: 9000 });

    const updateCalls = stub({ id: 7 });
    await updateMemberDiscount(7, {
      tier: "pro",
      modelPattern: "*",
      taskPattern: "*",
      discountBp: 8000,
      priority: 1,
      status: "disabled",
    });
    expect(updateCalls[0]?.url).toBe("http://billing.internal:4003/admin/member-discounts/7");

    const deleteCalls = stub({ id: 7, deleted: true });
    await deleteMemberDiscount(7);
    expect(deleteCalls[0]?.url).toBe("http://billing.internal:4003/admin/member-discounts/7");
  });

  it("活动：建的时候把操作人带上（billing 那边没有鉴权，这是唯一的来路）", async () => {
    const calls = stub({ id: 3, code: "night-70" });

    await createPromotion(
      {
        code: "night-70",
        name: "夜间 7 折",
        discountBp: 7000,
        modelIds: ["seedance-*"],
        taskTypes: null,
        tierScope: ["pro", "max"],
        startAt: "2026-10-01T00:00",
        endAt: "2026-11-01T00:00",
        dailyTimeStart: "22:00",
        dailyTimeEnd: "06:00",
        daysOfWeek: [1, 5],
        tz: "Asia/Shanghai",
        status: "draft",
        priority: 0,
      },
      "42",
    );

    expect(calls[0]?.url).toBe("http://billing.internal:4003/admin/promotions?operator=42");
    // null 必须原样外发：它是「不限 / 全天」这个状态，被 JSON.stringify 丢掉就变成了
    // 「没填」—— billing 那一侧会按默认值处理，界面上看到的和库里存的就对不上了
    expect(calls[0]?.body).toMatchObject({ taskTypes: null, daysOfWeek: [1, 5] });
  });

  it("折扣写入被拒（400）→ DiscountRejectedError，且带上 billing 的原话", async () => {
    stub({ code: "INVALID_ARGUMENT", message: "折扣必须大于 0：万分比 0 表示免费" }, 400);

    await expect(
      createMemberDiscount({
        tier: "pro",
        modelPattern: "*",
        taskPattern: "*",
        discountBp: 0,
        priority: 0,
        status: "enabled",
      }),
    ).rejects.toThrow(DiscountRejectedError);
    await expect(
      deleteMemberDiscount(7),
    ).rejects.toThrow(/折扣必须大于 0/);
  });

  it("目标已被删（404）→ DiscountNotFoundError，与 400 分开（一个刷新、一个改表单）", async () => {
    stub({ code: "NOT_FOUND", message: "活动不存在（可能已被删除）：id=7" }, 404);

    await expect(updatePromotion(7, PROMOTION_INPUT)).rejects.toThrow(DiscountNotFoundError);
  });

  it("billing 不可用（502）→ BillingAdminError，与服务故障同向", async () => {
    stub({ message: "网关超时" }, 502);

    await expect(listPromotions()).rejects.toThrow(BillingAdminError);
  });
});
