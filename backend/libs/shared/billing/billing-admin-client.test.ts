import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  AdminGrantResponseSchema,
  AdminDeleteMemberDiscountResponseSchema,
  AdminListMemberDiscountsResponseSchema,
  AdminListTransactionsResponseSchema,
  AdminMemberDiscountSchema,
  AdminPromotionSchema,
  AdminPublishCatalogResponseSchema,
  AdminTransactionItemSchema,
  AdminUpsertMemberDiscountResponseSchema,
  AdminUpsertPromotionResponseSchema,
  type AdminGrantRequest,
  type AdminUpsertMemberDiscountRequest,
  type AdminUpsertPromotionRequest,
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


vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

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
  status: "enabled",
  priority: 0,
};

describe("billing-admin-client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("管理端 gRPC 地址未配置 → 直接抛（发放配不出地址时不许静默跳过）", async () => {
    vi.stubEnv("BILLING_GRPC_URL", "");
    await expect(grantCredits({ userId: 1, credits: 1, bizId: "RC1" })).rejects.toThrow(
      BillingAdminConfigError,
    );
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

  it("发放：用我们自己的交易单号做幂等键，source 是 purchased", async () => {
    freshGrpcUrl();
    const seen: AdminGrantRequest[] = [];
    grpcAdminService({
      adminGrant: (req) => {
        seen.push(req);
        return create(AdminGrantResponseSchema, { lotId: 77n });
      },
    });

    const result = await grantCredits({ userId: 9001, credits: 1500, bizId: "RC1" });

    expect(seen[0]?.userId).toBe(9001n);
    expect(seen[0]?.source).toBe("purchased");
    expect(seen[0]?.amount).toBe(1500n);
    expect(seen[0]?.bizId).toBe("RC1");
    expect(seen[0]?.bizType).toBe("recharge");
    expect(seen[0]?.expiresAt).toBe("");
    expect(result).toEqual({ lotId: "77", duplicated: false, existingBizId: null });
  });

  it("重复发放 → 当成「已经发过了」的正常结果，不当成故障", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminGrant: () => create(AdminGrantResponseSchema, { duplicated: true }),
    });
    await expect(grantCredits({ userId: 1, credits: 1500, bizId: "RC1" })).resolves.toEqual({
      lotId: "",
      duplicated: true,
      existingBizId: null,
    });
  });

  it("★ 重复发放带上 existingBizId：调用方靠它分辨「我自己发过」与「别人先占了」", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminGrant: () =>
        create(AdminGrantResponseSchema, {
          duplicated: true,
          existingBizId: "RC-FIRST",
        }),
    });

    const result = await grantCredits({ userId: 1, credits: 1000, bizId: "RC-SECOND" });

    expect(result).toEqual({ lotId: "", duplicated: true, existingBizId: "RC-FIRST" });
  });

  it("其它错误码 → 抛错（调用方要让网关重投）", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminGrant: () => {
        throw new ConnectError("boom", Code.Internal);
      },
    });
    await expect(grantCredits({ userId: 1, credits: 1, bizId: "RC1" })).rejects.toThrow(
      BillingAdminError,
    );
  });


  it("读当前目录：连文档原文一起带回来（管理端页面的编辑起点）", async () => {
    freshGrpcUrl();
    grpcActiveCatalog({
      version: 3,
      documentHash: "abc",
      creditsPerYuan: 15,
      documentJson: '{"schemaVersion":1}',
    });

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
    await expect(fetchCreditsPerYuan()).rejects.toThrow(BillingAdminConfigError);
  });


  it("流水：预扣额没设 → null（**不是 0，也不是 undefined**）", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminListTransactions: () =>
        create(AdminListTransactionsResponseSchema, {
          items: [
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
    const HUGE_JOB_ID = 9_007_199_254_740_993n;
    freshGrpcUrl();
    grpcAdminService({
      adminListTransactions: () =>
        create(AdminListTransactionsResponseSchema, {
          items: [
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

    expect(seen).toEqual([0n, 42n]);
  });

  it("发布：文档原文交给 gRPC，不包一层 {document: ...}", async () => {
    freshGrpcUrl();
    const seen: string[] = [];
    grpcAdminService({
      adminPublishCatalog: (req) => {
        seen.push(req.documentJson);
        return create(AdminPublishCatalogResponseSchema, {
          catalogVersion: 4n,
          documentHash: "def",
          creditsPerYuan: 15n,
        });
      },
    });

    const document = '{"schemaVersion":1,"creditsPerYuan":15}';
    await expect(
      publishCatalog({ document, publishedBy: "42", note: "改价" }),
    ).resolves.toEqual({
      catalogVersion: 4,
      documentHash: "def",
      creditsPerYuan: 15,
    });

    expect(seen[0]).toBe(document);
  });

  it("发布：文档被拒（INVALID_ARGUMENT）→ 抛 CatalogRejectedError 并带上 billing 的原话", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminPublishCatalog: () => {
        throw new ConnectError(
          "INVALID_ARGUMENT: baseUnit 指向不存在的维度 usage.x",
          Code.InvalidArgument,
        );
      },
    });

    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(CatalogRejectedError);
    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(/usage\.x/);
  });

  it("发布：服务不可用 → BillingAdminError（可重试的一类）", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminPublishCatalog: () => {
        throw new ConnectError("unavailable", Code.Unavailable);
      },
    });

    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(BillingAdminError);
  });


  it("会员折扣：列 / 建 / 改 / 删各打对 RPC", async () => {
    freshGrpcUrl();
    const lists: Array<{ tier: string; status: string }> = [];
    const upserts: AdminUpsertMemberDiscountRequest[] = [];
    const deletes: bigint[] = [];
    grpcAdminService({
      adminListMemberDiscounts: (req) => {
        lists.push({ tier: req.tier, status: req.status });
        return create(AdminListMemberDiscountsResponseSchema, {
          items: [
            create(AdminMemberDiscountSchema, {
              id: 1n,
              tier: "pro",
              modelPattern: "*",
              taskPattern: "*",
              discountBp: 9000,
              status: "enabled",
            }),
          ],
        });
      },
      adminUpsertMemberDiscount: (req) => {
        upserts.push(req);
        return create(AdminUpsertMemberDiscountResponseSchema, {
          discount: create(AdminMemberDiscountSchema, {
            id: req.id === 0n ? 7n : req.id,
            tier: req.input?.tier ?? "",
            discountBp: req.input?.discountBp ?? 0,
          }),
        });
      },
      adminDeleteMemberDiscount: (req) => {
        deletes.push(req.id);
        return create(AdminDeleteMemberDiscountResponseSchema, {
          id: req.id,
          deleted: true,
        });
      },
    });

    const listed = await listMemberDiscounts({ tier: "pro", status: "enabled" });
    await listMemberDiscounts();
    expect(lists).toEqual([
      { tier: "pro", status: "enabled" },
      { tier: "", status: "" },
    ]);
    expect(listed[0]).toMatchObject({ id: 1, tier: "pro", discountBp: 9000 });

    await createMemberDiscount({
      tier: "pro",
      modelPattern: "*",
      taskPattern: "*",
      discountBp: 9000,
      priority: 0,
      status: "enabled",
    });
    expect(upserts[0]?.id).toBe(0n);
    expect(upserts[0]?.input?.tier).toBe("pro");
    expect(upserts[0]?.input?.discountBp).toBe(9000);

    await updateMemberDiscount(7, {
      tier: "pro",
      modelPattern: "*",
      taskPattern: "*",
      discountBp: 8000,
      priority: 1,
      status: "disabled",
    });
    expect(upserts[1]?.id).toBe(7n);
    expect(upserts[1]?.input?.discountBp).toBe(8000);

    await deleteMemberDiscount(7);
    expect(deletes).toEqual([7n]);
  });

  it("活动：建的时候把操作人带上，空范围归一成空数组", async () => {
    freshGrpcUrl();
    const seen: AdminUpsertPromotionRequest[] = [];
    grpcAdminService({
      adminUpsertPromotion: (req) => {
        seen.push(req);
        return create(AdminUpsertPromotionResponseSchema, {
          promotion: create(AdminPromotionSchema, {
            id: 3n,
            code: req.input?.code ?? "",
            startAt: req.input?.startAt ?? "",
            endAt: req.input?.endAt ?? "",
          }),
        });
      },
    });

    await createPromotion(PROMOTION_INPUT, "42");

    expect(seen[0]?.id).toBe(0n);
    expect(seen[0]?.operator).toBe("42");
    expect(seen[0]?.input?.taskTypes).toEqual([]);
    expect(seen[0]?.input?.daysOfWeek).toEqual([]);
    expect(seen[0]?.input?.startAt).toBe("2026-10-01T00:00");
    expect(seen[0]?.input?.endAt).toBe("2026-11-01T00:00");
  });

  it("折扣写入被拒（INVALID_ARGUMENT）→ DiscountRejectedError，且带上 billing 的原话", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminUpsertMemberDiscount: () => {
        throw new ConnectError(
          "INVALID_ARGUMENT: 折扣必须大于 0：万分比 0 表示免费",
          Code.InvalidArgument,
        );
      },
      adminDeleteMemberDiscount: () => {
        throw new ConnectError(
          "INVALID_ARGUMENT: 折扣必须大于 0：万分比 0 表示免费",
          Code.InvalidArgument,
        );
      },
    });

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
    await expect(deleteMemberDiscount(7)).rejects.toThrow(/折扣必须大于 0/);
  });

  it("目标已被删（NOT_FOUND）→ DiscountNotFoundError，与 INVALID_ARGUMENT 分开", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminUpsertPromotion: () => {
        throw new ConnectError(
          "NOT_FOUND: 活动不存在（可能已被删除）：id=7",
          Code.NotFound,
        );
      },
    });

    await expect(updatePromotion(7, PROMOTION_INPUT)).rejects.toThrow(DiscountNotFoundError);
  });

  it("billing 不可用 → BillingAdminError，与服务故障同向", async () => {
    freshGrpcUrl();
    grpcAdminService({
      adminListPromotions: () => {
        throw new ConnectError("unavailable", Code.Unavailable);
      },
    });

    await expect(listPromotions()).rejects.toThrow(BillingAdminError);
  });
});
