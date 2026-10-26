import { describe, expect, it, vi } from "vitest";

import { AdminDashboardController } from "./dashboard.controller.js";


function createController(stats = vi.fn().mockResolvedValue({ totalUsers: 1 })) {
  return { controller: new AdminDashboardController({ stats } as never), stats };
}

describe("AdminDashboardController.stats", () => {
  it("不传区间 = 今天（北京时间），并把算好的区间交给 service", async () => {
    const { controller, stats } = createController();

    const result = await controller.stats({});

    expect(result.success).toBe(true);
    const range = stats.mock.calls[0]?.[0];
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    expect(range).toMatchObject({ from: today, to: today });
    expect(range.start).toBeInstanceOf(Date);
    expect(range.endExclusive).toBeInstanceOf(Date);
  });

  it("显式区间原样透传", async () => {
    const { controller, stats } = createController();

    await controller.stats({ from: "2026-09-01", to: "2026-09-30" });

    expect(stats.mock.calls[0]?.[0]).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("★ 超过 30 天 → **400**（不是 500），且不查任何数", async () => {
    const { controller, stats } = createController();

    await expect(
      controller.stats({ from: "2026-01-01", to: "2026-12-31" }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("最多 30 天") });
    expect(stats).not.toHaveBeenCalled();
  });

  it("★ 起始晚于结束 → 400，文案说清是顺序问题", async () => {
    const { controller, stats } = createController();

    await expect(
      controller.stats({ from: "2026-09-30", to: "2026-09-01" }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("不能晚于") });
    expect(stats).not.toHaveBeenCalled();
  });

  it("只给一端 → 400（另一端有太多合理猜测，猜错会静默少统计一段）", async () => {
    const { controller, stats } = createController();

    await expect(controller.stats({ from: "2026-09-01" })).rejects.toMatchObject({ status: 400 });
    expect(stats).not.toHaveBeenCalled();
  });

  it("仓储/依赖抛错 → 转成 500 且消息透传", async () => {
    const { controller } = createController(vi.fn().mockRejectedValue(new Error("db down")));

    await expect(controller.stats({})).rejects.toMatchObject({ status: 500, message: "db down" });
  });
});
