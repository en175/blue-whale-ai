import { describe, expect, it, vi } from "vitest";

import { handleGetMe } from "./handle-get-me.js";

// GET /api/me：当前用户信息 → {user_id, username, phone, has_password}。

describe("handleGetMe", () => {
  it("存在 → 200 + UserInfoView", async () => {
    const repo = {
      findInfoById: vi.fn().mockResolvedValue({
        user_id: "13",
        username: "用户ABCD",
        phone: "13047660776",
        has_password: false,
      }),
    };
    const result = await handleGetMe("13", { users: repo });
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { user_id: "13", username: "用户ABCD", phone: "13047660776", has_password: false },
    });
  });

  it("has_password=true（password 非空）", async () => {
    const repo = {
      findInfoById: vi.fn().mockResolvedValue({
        user_id: "13",
        username: "x",
        phone: "13000000000",
        has_password: true,
      }),
    };
    const result = await handleGetMe("13", { users: repo });
    expect(result.data).toMatchObject({ has_password: true });
  });

  it("不存在 → 401", async () => {
    const repo = { findInfoById: vi.fn().mockResolvedValue(null) };
    const result = await handleGetMe("999", { users: repo });
    expect(result).toEqual({ code: 401, msg: "用户不存在", data: null });
  });
});
