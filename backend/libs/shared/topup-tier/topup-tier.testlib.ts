/* ============================================
 * 档位域的测试夹具：repo 桩 + 视图工厂。
 *
 * 放在领域目录而不是某个消费方的 testlib 里 —— 桩的是 `TopupTierRepo`，
 * 消费方（充值域、管理端）各自 import，谁都不必依赖对方的测试夹具。
 * ============================================ */
import type {
  TopupTierRepo,
  TopupTierView,
} from "@lib/shared/persistence/index.js";

/**
 * 一份**满足 `TopupTierView` 全部必填字段**的视图。用例只需覆盖关心的那几个，
 * 其余取这里的默认值。
 *
 * <p>为什么要有它：`TopupTierView` 有二十来个必填字段，手写部分对象再强转
 * （`as never` / `as unknown as`）会把「这里其实不满足契约」这件事一并盖掉。
 */
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

/**
 * 档位 repo 的测试桩：**只实现用例真正会走的那几个方法**，其余一律拒绝。
 *
 * <p>比 `{ … } as unknown as TopupTierRepo` 强的地方：类型对不上不再是**被静默绕过**——
 * 没桩的方法被调到会直接报出方法名，而不是含糊的 `undefined`；签名不符则会在编辑器里
 * 标红。（本仓测试文件默认不进 `tsc`，所以这条是编辑器级保障，不是门禁级。）
 */
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
