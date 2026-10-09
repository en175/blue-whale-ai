import type {
  TopupTierRepo,
  TopupTierView,
} from "@lib/shared/persistence/index.js";

export function makeTierView(overrides: Partial<TopupTierView> = {}): TopupTierView {
  return {
    id: "7",
    name: "1000积分",
    baseCredits: 1_000,
    originalPrice: 100,
    discount: 1,
    price: 100,
    isRecommended: false,
    status: "active",
    startTime: null,
    endTime: null,
    sortOrder: 1,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    description: "",
    bonusCredits: 0,
    activityTag: "",
    buttonText: "",
    firstPurchaseEligible: false,
    creditsValidMonths: 24,
    permission: "all",
    permissionAllowlist: [],
    permissionDeniedHint: "",
    ...overrides,
  };
}

export function stubTierRepo(overrides: Partial<TopupTierRepo> = {}): TopupTierRepo {
  const unused = (method: string) => () =>
    Promise.reject(new Error(`stubTierRepo 未实现 ${method}，本用例不该走到这里`));
  return {
    listAll: unused("listAll"),
    listActive: unused("listActive"),
    getById: unused("getById"),
    create: unused("create"),
    update: unused("update"),
    remove: unused("remove"),
    updateSortOrder: unused("updateSortOrder"),
    ...overrides,
  };
}
