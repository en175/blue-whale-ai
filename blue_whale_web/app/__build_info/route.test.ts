// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "./route";

describe("/__build_info route（IK2BCH）", () => {
  beforeEach(() => {
    delete process.env.GIT_COMMIT;
    delete process.env.BUILD_TIME;
  });

  it("返回 git_commit / build_time 字段", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("git_commit");
    expect(json).toHaveProperty("build_time");
    expect(typeof json.git_commit).toBe("string");
    expect(typeof json.build_time).toBe("string");
  });

  it("ENV 缺省时回落 unknown", async () => {
    const json = await (await GET()).json();
    expect(json.git_commit).toBe("unknown");
    expect(json.build_time).toBe("unknown");
  });

  it("ENV 注入时透传构建身份", async () => {
    process.env.GIT_COMMIT = "abc1234";
    process.env.BUILD_TIME = "2026-07-20T10:00:00Z";
    const json = await (await GET()).json();
    expect(json.git_commit).toBe("abc1234");
    expect(json.build_time).toBe("2026-07-20T10:00:00Z");
  });
});
