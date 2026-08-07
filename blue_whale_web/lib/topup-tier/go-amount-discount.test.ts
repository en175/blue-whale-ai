import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRootOption: vi.fn(),
  putRootOption: vi.fn(),
}));

vi.mock("@blue-whale/core", () => ({
  createNewApiClient: () => ({
    getRootOption: mocks.getRootOption,
    putRootOption: mocks.putRootOption,
  }),
}));

import {
  loadGoDiscountSyncConfig,
  removeTierDiscountFromGo,
  syncAllTierDiscountsToGo,
  syncTierDiscountToGo,
} from "./go-amount-discount";

const DISCOUNT_KEY = "payment_setting.amount_discount";

const CONFIGURED_ENV = {
  NEW_API_BASE_URL: "http://new-api.test",
  NEW_API_ROOT_ACCESS_TOKEN: "root-tok",
  NEW_API_ROOT_USER_ID: "1",
};

describe("go-amount-discount 同步", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadGoDiscountSyncConfig", () => {
    it("env 齐全 → 解析出配置", () => {
      expect(loadGoDiscountSyncConfig(CONFIGURED_ENV)).toEqual({
        baseUrl: "http://new-api.test",
        rootToken: "root-tok",
        rootUserId: 1,
      });
    });

    it("缺凭证 / 非法 user id → null", () => {
      expect(
        loadGoDiscountSyncConfig({ NEW_API_BASE_URL: "http://x" }),
      ).toBeNull();
      expect(
        loadGoDiscountSyncConfig({
          ...CONFIGURED_ENV,
          NEW_API_ROOT_USER_ID: "abc",
        }),
      ).toBeNull();
      expect(
        loadGoDiscountSyncConfig({
          ...CONFIGURED_ENV,
          NEW_API_ROOT_ACCESS_TOKEN: "",
        }),
      ).toBeNull();
    });
  });

  describe("syncTierDiscountToGo", () => {
    it("未配置凭证 → no-op，不调用 Go，返回 false", async () => {
      const ok = await syncTierDiscountToGo(100, 0.85, {
        NEW_API_BASE_URL: "http://x",
      });
      expect(ok).toBe(false);
      expect(mocks.getRootOption).not.toHaveBeenCalled();
      expect(mocks.putRootOption).not.toHaveBeenCalled();
    });

    it("set 折扣：打 payment_setting.amount_discount 键，保留其它折扣 key，value 为 JSON 字符串", async () => {
      // Go 实际存的是 pretty-printed JSON，解析须兼容
      mocks.getRootOption.mockResolvedValue('{\n  "50": 0.9\n}');

      const ok = await syncTierDiscountToGo(100, 0.85, CONFIGURED_ENV);

      expect(ok).toBe(true);
      expect(mocks.getRootOption).toHaveBeenCalledWith(
        "root-tok",
        1,
        DISCOUNT_KEY,
      );
      expect(mocks.putRootOption).toHaveBeenCalledTimes(1);
      const [token, userId, key, value] = mocks.putRootOption.mock.calls[0];
      expect(token).toBe("root-tok");
      expect(userId).toBe(1);
      expect(key).toBe(DISCOUNT_KEY);
      expect(typeof value).toBe("string"); // 必须字符串，否则 Go UpdateOption 损坏
      // 新增 100→0.85，保留 50→0.9
      expect(JSON.parse(value)).toEqual({ "50": 0.9, "100": 0.85 });
    });

    it("原价非整数 → 按四舍五入取整做 key（对齐整数 N）", async () => {
      mocks.getRootOption.mockResolvedValue("{}");
      await syncTierDiscountToGo(99.6, 0.8, CONFIGURED_ENV);
      const value = JSON.parse(mocks.putRootOption.mock.calls[0][3]);
      expect(value).toEqual({ "100": 0.8 });
    });

    it("折扣键不存在 → 从空表重建", async () => {
      mocks.getRootOption.mockResolvedValue(null);
      await syncTierDiscountToGo(100, 0.85, CONFIGURED_ENV);
      const value = JSON.parse(mocks.putRootOption.mock.calls[0][3]);
      expect(value).toEqual({ "100": 0.85 });
    });

    it("value 非对象（异常数据）→ 当空表处理，不抛", async () => {
      mocks.getRootOption.mockResolvedValue("[1,2,3]");
      await syncTierDiscountToGo(100, 0.85, CONFIGURED_ENV);
      const value = JSON.parse(mocks.putRootOption.mock.calls[0][3]);
      expect(value).toEqual({ "100": 0.85 });
    });
  });

  describe("removeTierDiscountFromGo", () => {
    it("移除该 N 的 key，保留其它折扣", async () => {
      mocks.getRootOption.mockResolvedValue(
        JSON.stringify({ "50": 0.9, "100": 0.85 }),
      );

      const ok = await removeTierDiscountFromGo(100, CONFIGURED_ENV);

      expect(ok).toBe(true);
      const [key, value] = mocks.putRootOption.mock.calls[0].slice(2);
      expect(key).toBe(DISCOUNT_KEY);
      expect(JSON.parse(value)).toEqual({ "50": 0.9 });
    });

    it("未配置凭证 → no-op，返回 false", async () => {
      const ok = await removeTierDiscountFromGo(100, {});
      expect(ok).toBe(false);
      expect(mocks.putRootOption).not.toHaveBeenCalled();
    });
  });

  describe("syncAllTierDiscountsToGo（IK75PR 存量档位补同步）", () => {
    it("整表补全：把档位折扣写进对应 key，保留 Go 表其它 key", async () => {
      mocks.getRootOption.mockResolvedValue('{\n  "10": 1\n}');

      const ok = await syncAllTierDiscountsToGo(
        [
          { originalPrice: 4, discount: 0.02 },
          { originalPrice: 11, discount: 0.01 },
        ],
        CONFIGURED_ENV,
      );

      expect(ok).toBe(2);
      expect(mocks.putRootOption).toHaveBeenCalledTimes(1);
      const [, , key, value] = mocks.putRootOption.mock.calls[0];
      expect(key).toBe(DISCOUNT_KEY);
      expect(typeof value).toBe("string");
      expect(JSON.parse(value)).toEqual({ "10": 1, "4": 0.02, "11": 0.01 });
    });

    it("空档位列表 → 直接返回 0，不调用 Go", async () => {
      const ok = await syncAllTierDiscountsToGo([], CONFIGURED_ENV);
      expect(ok).toBe(0);
      expect(mocks.getRootOption).not.toHaveBeenCalled();
      expect(mocks.putRootOption).not.toHaveBeenCalled();
    });

    it("未配置凭证 → no-op，返回 0", async () => {
      const ok = await syncAllTierDiscountsToGo(
        [{ originalPrice: 4, discount: 0.02 }],
        { NEW_API_BASE_URL: "http://x" },
      );
      expect(ok).toBe(0);
      expect(mocks.putRootOption).not.toHaveBeenCalled();
    });

    it("折扣非法（<=0 或 >1）→ 跳过该 key，不写坏数据", async () => {
      mocks.getRootOption.mockResolvedValue("{}");
      await syncAllTierDiscountsToGo(
        [
          { originalPrice: 4, discount: 0.02 },
          { originalPrice: 5, discount: 0 }, // 非法，跳过
          { originalPrice: 6, discount: 1.5 }, // 非法，跳过
        ],
        CONFIGURED_ENV,
      );
      const value = JSON.parse(mocks.putRootOption.mock.calls[0][3]);
      expect(value).toEqual({ "4": 0.02 });
    });

    it("并发串行：全量同步与单档同步互不覆盖", async () => {
      let stored: Record<string, number> = { "10": 1 };
      mocks.getRootOption.mockImplementation(async () =>
        JSON.stringify(stored),
      );
      mocks.putRootOption.mockImplementation(async (_t, _u, _k, value) => {
        stored = JSON.parse(value as string);
      });

      await Promise.all([
        syncAllTierDiscountsToGo(
          [{ originalPrice: 4, discount: 0.02 }],
          CONFIGURED_ENV,
        ),
        syncTierDiscountToGo(100, 0.85, CONFIGURED_ENV),
      ]);

      expect(stored).toEqual({ "10": 1, "4": 0.02, "100": 0.85 });
    });
  });

  describe("并发串行化", () => {
    it("两个并发同步不互相覆盖：RMW 串行后两 key 都在表里", async () => {
      // 模拟慢速 Go option 接口：若无串行化，两个 RMW 会读到同一份旧表，
      // 后写覆盖先写、丢一个 key（管理端快速连建两档即可触发）。
      let stored: Record<string, number> = {};
      mocks.getRootOption.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return JSON.stringify(stored);
      });
      mocks.putRootOption.mockImplementation(async (_t, _u, _k, value) => {
        await new Promise((r) => setTimeout(r, 5));
        stored = JSON.parse(value as string);
      });

      await Promise.all([
        syncTierDiscountToGo(100, 0.85, CONFIGURED_ENV),
        syncTierDiscountToGo(200, 0.9, CONFIGURED_ENV),
      ]);

      expect(stored).toEqual({ "100": 0.85, "200": 0.9 });
      expect(mocks.putRootOption).toHaveBeenCalledTimes(2);
    });

    it("一次同步失败不断裂队列：后续同步仍正常执行", async () => {
      let stored: Record<string, number> = {};
      mocks.getRootOption.mockImplementation(async () =>
        JSON.stringify(stored),
      );
      mocks.putRootOption
        .mockRejectedValueOnce(new Error("Go 502"))
        .mockImplementation(async (_t, _u, _k, value) => {
          stored = JSON.parse(value as string);
        });

      await expect(
        syncTierDiscountToGo(100, 0.85, CONFIGURED_ENV),
      ).rejects.toThrow("Go 502");
      // 队列未断裂，下一次同步照常读-改-写
      await syncTierDiscountToGo(200, 0.9, CONFIGURED_ENV);
      expect(stored).toEqual({ "200": 0.9 });
    });
  });
});
