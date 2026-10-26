import { create } from "@bufbuild/protobuf";
import { createRouterTransport, type ServiceImpl, type Transport } from "@connectrpc/connect";
import { vi } from "vitest";
import { BILLING_URL_ENV } from "./billing-client.js";
import {
  AdminConsumedCreditsResponseSchema,
  AdminGetActiveCatalogResponseSchema,
  BillingAdminService,
  BillingService,
  type AdminConsumedCreditsRequest,
} from "../../contracts/gen/billing/v1/billing_pb.js";

export type AdminServiceHandlers = Partial<ServiceImpl<typeof BillingAdminService>>;

export type BillingServiceHandlers = Partial<ServiceImpl<typeof BillingService>>;

let currentRouter: Transport | undefined;

export function grpcStubTransport(): Transport {
  if (!currentRouter) {
    throw new Error(
      "测试没先装 gRPC 桩：先调 grpcAdminService / grpcBillingService / "
        + "grpcActiveCatalog / grpcConsumedCredits",
    );
  }
  return currentRouter;
}

let urlSeq = 0;

export function freshGrpcUrl(): void {
  urlSeq += 1;
  vi.stubEnv(BILLING_URL_ENV, `http://billing.grpc.test:4004/t${urlSeq}`);
}

export function grpcAdminService(handlers: AdminServiceHandlers): void {
  currentRouter = createRouterTransport(({ service }) => {
    service(BillingAdminService, handlers);
  });
}

export function grpcBillingService(handlers: BillingServiceHandlers): void {
  currentRouter = createRouterTransport(({ service }) => {
    service(BillingService, handlers);
  });
}

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
