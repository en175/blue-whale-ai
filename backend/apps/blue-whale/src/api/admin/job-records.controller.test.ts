import { describe, expect, it, vi } from "vitest";

import { AdminJobRecordsController } from "./job-records.controller.js";


function createController(
  listForAdmin = vi.fn().mockResolvedValue({ records: [], total: 0, size: 20, current: 1 }),
) {
  const findAdminUserIdByKeyword = vi.fn().mockResolvedValue(undefined);
  const loadAdminUserIdentities = vi.fn().mockResolvedValue(new Map());
  return {
    controller: new AdminJobRecordsController(
      { listForAdmin } as never,
      { findAdminUserIdByKeyword, loadAdminUserIdentities } as never,
    ),
    listForAdmin,
    findAdminUserIdByKeyword,
    loadAdminUserIdentities,
  };
}

const RECORD = {
  job_id: "job-1",
  user_id: "42",
  project_id: "",
  type: "text2video",
  status: "succeeded",
  progress: 100,
  retry_count: 0,
  created_at: "2026-09-25T10:00:00+08:00",
  updated_at: "2026-09-25T10:01:00+08:00",
  error: null,
};

describe("AdminJobRecordsController.list", () => {
  it("缺省：第 1 页 20 条，不带任何筛选项（= 全站）", async () => {
    const { controller, listForAdmin, findAdminUserIdByKeyword } = createController();

    await expect(controller.list({})).resolves.toEqual({
      success: true,
      data: { list: [], total: 0 },
    });
    expect(listForAdmin).toHaveBeenCalledWith({ page: 1, size: 20 });
    expect(findAdminUserIdByKeyword).not.toHaveBeenCalled();
  });

  it("关键词命中一个用户 → 用它换来的 userId 过滤，projectId / type / status 透传", async () => {
    const { controller, listForAdmin, findAdminUserIdByKeyword } = createController();
    findAdminUserIdByKeyword.mockResolvedValue(42);

    await controller.list({
      page: "3",
      pageSize: "50",
      keyword: "13800008888",
      projectId: "77",
      type: "text2video",
      status: "failed",
    });

    expect(findAdminUserIdByKeyword).toHaveBeenCalledWith("13800008888");
    expect(listForAdmin).toHaveBeenCalledWith({
      page: 3,
      size: 50,
      userId: "42",
      projectId: "77",
      type: "text2video",
      status: "failed",
    });
  });

  it("★ 还认着旧的 `userId` 参数 —— 不认它就是静默回一页全站任务", async () => {
    const { controller, listForAdmin, findAdminUserIdByKeyword } = createController();
    findAdminUserIdByKeyword.mockResolvedValue(42);

    await controller.list({ userId: "42" });

    expect(findAdminUserIdByKeyword).toHaveBeenCalledWith("42");
    expect(listForAdmin).toHaveBeenCalledWith({ page: 1, size: 20, userId: "42" });
  });

  it("关键词查不到人 → 空页，**不查任务表**", async () => {
    const { controller, listForAdmin, findAdminUserIdByKeyword } = createController();
    findAdminUserIdByKeyword.mockResolvedValue(undefined);

    await expect(controller.list({ keyword: "查无此人" })).resolves.toEqual({
      success: true,
      data: { list: [], total: 0 },
    });
    expect(listForAdmin).not.toHaveBeenCalled();
  });

  it("projectId 非正整数 → 400，且不查库", async () => {
    const { controller, listForAdmin } = createController();

    for (const bad of ["abc", "0", "-1", "1.5"]) {
      await expect(controller.list({ projectId: bad })).rejects.toMatchObject({ status: 400 });
    }
    expect(listForAdmin).not.toHaveBeenCalled();
  });

  it("★ 同时给了查不到人的关键词和非法 projectId → 仍然是 400，不是 200 空页", async () => {
    const { controller, findAdminUserIdByKeyword, listForAdmin } = createController();
    findAdminUserIdByKeyword.mockResolvedValue(undefined);

    await expect(
      controller.list({ keyword: "查无此人", projectId: "abc" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(listForAdmin).not.toHaveBeenCalled();
  });

  it("★ 用户名 / 手机号按本页的 user_id 集合一次批量回填（不逐行查）", async () => {
    const { controller, loadAdminUserIdentities } = createController(
      vi.fn().mockResolvedValue({ records: [RECORD], total: 1, size: 20, current: 1 }),
    );
    loadAdminUserIdentities.mockResolvedValue(
      new Map([[42, { nickname: "张小明", phone: "13800008888" }]]),
    );

    await expect(controller.list({})).resolves.toMatchObject({
      data: { list: [{ job_id: "job-1", nickname: "张小明", phone: "13800008888" }], total: 1 },
    });
    expect(loadAdminUserIdentities).toHaveBeenCalledTimes(1);
    expect(loadAdminUserIdentities).toHaveBeenCalledWith([42]);
  });

  it("用户没手机号（存量用户是常态）→ phone 收敛成 null，**不是空串**", async () => {
    const { controller, loadAdminUserIdentities } = createController(
      vi.fn().mockResolvedValue({ records: [RECORD], total: 1, size: 20, current: 1 }),
    );
    loadAdminUserIdentities.mockResolvedValue(new Map([[42, { nickname: "老用户", phone: "" }]]));

    await expect(controller.list({})).resolves.toMatchObject({
      data: { list: [{ nickname: "老用户", phone: null }] },
    });
  });

  it("用户查不到（已被清理）→ 用户名手机号都是 null，行照常返回", async () => {
    const { controller } = createController(
      vi.fn().mockResolvedValue({ records: [RECORD], total: 1, size: 20, current: 1 }),
    );

    await expect(controller.list({})).resolves.toMatchObject({
      data: { list: [{ user_id: "42", nickname: null, phone: null }] },
    });
  });

  it("仓储抛错 → 转成 AdminException", async () => {
    const { controller } = createController(vi.fn().mockRejectedValue(new Error("db down")));

    await expect(controller.list({})).rejects.toMatchObject({
      status: 500,
      message: "db down",
    });
  });
});
