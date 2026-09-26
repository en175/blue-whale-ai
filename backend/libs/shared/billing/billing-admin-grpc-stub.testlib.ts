/* ============================================
 * billing 管理面（`BillingAdminService`）的**内存 gRPC 测试桩**。
 *
 * 命名 `*.testlib.ts`：tsconfig 排除编译、vitest 不当作用例文件收集
 * （同 `new-api-client.testlib.ts` / `skill-repo.testlib.ts`）。
 *
 * 运营面「读」接口迁到 gRPC 之后，三处测试都要把同一个服务顶成内存 router，
 * 搭法只在这里写一遍：
 *   · `billing-admin-client.test.ts` —— 客户端自己的映射与 presence
 *   · `recharge.service.test.ts`      —— 换算率来自 `AdminGetActiveCatalog`
 *   · `dashboard.service.test.ts`     —— 消耗合计来自 `AdminConsumedCredits`
 *
 * ⚠️ `vi.mock("@connectrpc/connect-node", …)` 那几行**必须留在各自的测试文件里**：
 *    vitest 会把 `vi.mock` 提升到 import 之前执行，写进本模块就等于在测试文件 import
 *    被测模块**之前**先跑一次 —— mock 不会作用到被测模块。所以本模块只导出供它转发的
 *    {@link grpcStubTransport}，把「装什么 router」留给调用方。
 *
 * ⚠️ 为什么是内存 router 而不是手写一个假 client：请求会真的过一遍 protobuf 序列化，
 *    而 `optional` 字段的 **presence**（没设 ⇒ 缺值，不是 0）与 int64 的 bigint 折算
 *    恰恰是这条迁移要钉的东西 —— 假 client 会把这一层整个跳过。
 * ============================================ */
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, type ServiceImpl, type Transport } from "@connectrpc/connect";
import { vi } from "vitest";
import { BILLING_URL_ENV } from "./billing-client.js";
import {
  AdminConsumedCreditsResponseSchema,
  AdminGetActiveCatalogResponseSchema,
  BillingAdminService,
  type AdminConsumedCreditsRequest,
} from "../../contracts/gen/billing/v1/billing_pb.js";

/** 管理面各方法的实现，允许只给一部分（没给的会回 UNIMPLEMENTED）。 */
export type AdminServiceHandlers = Partial<ServiceImpl<typeof BillingAdminService>>;

/**
 * 当前测试绑定的内存 router；没装过就是 `undefined`。
 *
 * <p>未装即抛而不是回落一个真地址：静默连出去会让「忘了装桩」表现成一次网络抖动，
 * 而它实际是测试自己写漏了。
 */
let currentRouter: Transport | undefined;

/**
 * 各测试文件的 `vi.mock` 工厂转发到这里 —— **调用点必须在测试体内**，见文件头。
 */
export function grpcStubTransport(): Transport {
  if (!currentRouter) {
    throw new Error(
      "测试没先装 gRPC 桩：先调 grpcAdminService / grpcActiveCatalog / grpcConsumedCredits",
    );
  }
  return currentRouter;
}

let urlSeq = 0;

/**
 * 每个测试换一个 gRPC 地址。
 *
 * <p>⚠️ **必须换**：客户端**按地址缓存**（真实环境里那是连接复用），同址会让第二个测试
 *    复用第一个测试绑的那个 transport，于是它测的还是上一个 case 的桩 —— 断言照样绿，
 *    只是测的不是它自己装的那份数据。
 *
 * <p>顺带把 `createGrpcTransport` 的调用时机钉在**每个测试内部**：这样它取到的必然是
 *    本测试装好的 router。
 */
export function freshGrpcUrl(): void {
  urlSeq += 1;
  vi.stubEnv(BILLING_URL_ENV, `http://billing.grpc.test:4004/t${urlSeq}`);
}

/**
 * 装一个只在内存里的 `BillingAdminService`，只注册给到的那几个方法。
 *
 * <p>**没注册的方法回 UNIMPLEMENTED**，不是静默成功 —— 「这条路径此刻打不通」正好用
 * 它表达，不必再造一个假地址（查单补偿里查余额那条就是靠它）。
 */
export function grpcAdminService(handlers: AdminServiceHandlers): void {
  currentRouter = createRouterTransport(({ service }) => {
    service(BillingAdminService, handlers);
  });
}

/**
 * 桩一份生效的定价目录（`AdminGetActiveCatalog`）。
 *
 * <p>返回的 `setCreditsPerYuan` 让**同一个测试里**改一次换算率：充值那条测的是
 * 「改口后新档位跟着变、已下订单仍按冻结值发」，重装 router 会把前半段的结果一起丢掉。
 */
export function grpcActiveCatalog(
  init: {
    version?: number;
    documentJson?: string;
    documentHash?: string;
    creditsPerYuan?: number;
  } = {},
): { setCreditsPerYuan: (value: number) => void } {
  const state = {
    version: init.version ?? 1,
    documentJson: init.documentJson ?? "",
    documentHash: init.documentHash ?? "",
    creditsPerYuan: init.creditsPerYuan ?? 15,
  };

  grpcAdminService({
    adminGetActiveCatalog: () =>
      create(AdminGetActiveCatalogResponseSchema, {
        version: BigInt(state.version),
        documentJson: state.documentJson,
        documentHash: state.documentHash,
        creditsPerYuan: BigInt(state.creditsPerYuan),
      }),
  });

  return {
    setCreditsPerYuan: (value: number) => {
      state.creditsPerYuan = value;
    },
  };
}

/**
 * 桩 `AdminConsumedCredits`，把每次请求的**入参**记下来。
 *
 * <p>⚠️ 记的是请求对象而不是 URL query：迁到 gRPC 之后「下发给 billing 的北京日界」
 *    是 proto 字段 `from`/`to`，断言必须落在它们身上 —— 换成 `toISOString` 的 UTC 串
 *    时这条要能红。
 */
export function grpcConsumedCredits(
  respond: (req: AdminConsumedCreditsRequest) => bigint = () => 0n,
): { requests: Array<{ from: string; to: string }> } {
  const requests: Array<{ from: string; to: string }> = [];

  grpcAdminService({
    adminConsumedCredits: (req) => {
      requests.push({ from: req.from, to: req.to });
      return create(AdminConsumedCreditsResponseSchema, { consumedCredits: respond(req) });
    },
  });

  return { requests };
}
