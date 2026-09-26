import { describe, expect, it, vi } from "vitest";

import { AdminJobRecordsController } from "./job-records.controller.js";

// 任务记录读 generation_jobs（本地表，offset 分页 + 总数）。
// 与用户面的 GET /api/jobs 同一张表，差别只有一条：这条可以不过滤用户（管理端全站视图）。

function createController(
  listForAdmin = vi.fn().mockResolvedValue({ records: [], total: 0, size: 20, current: 1 }),
) {
  return { controller: new AdminJobRecordsController({ listForAdmin } as never), listForAdmin };
}

describe("AdminJobRecordsController.list", () => {
  it("缺省：第 1 页 20 条，不带任何筛选项（= 全站）", async () => {
    const { controller, listForAdmin } = createController();

    await expect(controller.list({})).resolves.toEqual({
      success: true,
      data: { list: [], total: 0 },
    });
    expect(listForAdmin).toHaveBeenCalledWith({ page: 1, size: 20 });
  });

  it("全部筛选项透传（id 类保持字符串，不做 Number —— 它们可能超出安全整数范围）", async () => {
    const { controller, listForAdmin } = createController();

    await controller.list({
      page: "3",
      pageSize: "50",
      userId: " 9007199254740993 ",
      projectId: "77",
      type: "text2video",
      status: "failed",
    });

    expect(listForAdmin).toHaveBeenCalledWith({
      page: 3,
      size: 50,
      userId: "9007199254740993",
      projectId: "77",
      type: "text2video",
      status: "failed",
    });
  });

  it("userId / projectId 非正整数 → 400，且不查库", async () => {
    const { controller, listForAdmin } = createController();

    for (const bad of ["abc", "0", "-1", "1.5"]) {
      await expect(controller.list({ userId: bad })).rejects.toMatchObject({ status: 400 });
      await expect(controller.list({ projectId: bad })).rejects.toMatchObject({ status: 400 });
    }
    expect(listForAdmin).not.toHaveBeenCalled();
  });

  it("仓储抛错 → 转成 AdminException", async () => {
    const { controller } = createController(vi.fn().mockRejectedValue(new Error("db down")));

    await expect(controller.list({})).rejects.toMatchObject({
      status: 500,
      message: "db down",
    });
  });
});
