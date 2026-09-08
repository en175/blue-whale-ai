import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewApiError } from "@blue-whale/core";

import { MATERIAL_ACTIONS, MaterialService } from "./material.service.js";

const AUTH = "Bearer sk-test-key";

function stubFetch(responder: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      return responder(url, init);
    }),
  );
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 构造 MaterialService：mock PrismaService（groupRepo 未用时传哑对象），隔离数据库。 */
function makeService(prisma?: unknown) {
  return new MaterialService(
    prisma as never,
  );
}

describe("MaterialService —— 纯过境调用", () => {
  const originalBaseUrl = process.env.NEW_API_BASE_URL;

  beforeEach(() => {
    process.env.NEW_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.NEW_API_BASE_URL;
    } else {
      process.env.NEW_API_BASE_URL = originalBaseUrl;
    }
    vi.unstubAllGlobals();
  });

  it("白名单共 12 个 Action（组 5 + 素材 5 + 真人会话 2）", () => {
    expect(MATERIAL_ACTIONS).toHaveLength(12);
    expect(MATERIAL_ACTIONS).toContain("ListAssetGroups");
    expect(MATERIAL_ACTIONS).not.toContain("GetModerationResult");
  });

  it("白名单外 Action 拒绝且不发起请求", async () => {
    const calls = stubFetch(() => json({}));
    const service = makeService();
    await expect(
      service.callAction(AUTH, "GetModerationResult", {}),
    ).rejects.toMatchObject({ status: 400, code: "InvalidAction" });
    expect(calls).toHaveLength(0);
  });

  it("缺少上游执行凭证拒绝（401）", async () => {
    stubFetch(() => json({}));
    const service = makeService();
    await expect(
      service.callAction(undefined, "ListAssetGroups", {}),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.callAction("Bearer not-sk", "ListAssetGroups", {}),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("上游信封与状态码原样透传（404 不抛错）", async () => {
    const errorBody = {
      ResponseMetadata: { RequestId: "req_1", Action: "GetAsset" },
      ResponseError: { Code: "NotFound", Message: "resource not found" },
    };
    stubFetch(() => json(errorBody, 404));
    const service = makeService();
    const res = await service.callAction(AUTH, "GetAsset", { Id: "Asset-x" });
    expect(res).toEqual({ status: 404, body: errorBody });
  });

  it("请求以 Bearer sk- 打网关 /api/material/{Action}", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-1" } }));
    const service = makeService();
    await service.callAction(AUTH, "CreateAssetGroup", {
      Name: "g",
      GroupType: "AIGC",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://gateway.test/api/material/CreateAssetGroup");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("Authorization")).toBe(AUTH);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "g",
      GroupType: "AIGC",
    });
  });

  it("CreateVisualValidateSession 纯透传（前端传入的 CallbackURL 原样保留）", async () => {
    const calls = stubFetch(() => json({ BytedToken: "bt-1", H5Link: "https://h5" }));
    const service = makeService();
    await service.callAction(AUTH, "CreateVisualValidateSession", {
      Name: "真人组",
      CallbackURL: "https://web.test/auth-success",
      ProjectName: "p",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "真人组",
      CallbackURL: "https://web.test/auth-success",
      ProjectName: "p",
    });
  });

  it("CreateVisualValidateSession 未传 CallbackURL 时也纯透传", async () => {
    const calls = stubFetch(() => json({ BytedToken: "bt-1", H5Link: "https://h5" }));
    const service = makeService();
    await service.callAction(AUTH, "CreateVisualValidateSession", {
      Name: "真人组",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "真人组",
    });
  });

  it("其他 Action 请求体原样透传（含任意自定义字段）", async () => {
    const calls = stubFetch(() => json({ Result: {} }));
    const service = makeService();
    await service.callAction(AUTH, "CreateAsset", {
      GroupId: "group-1",
      URL: "https://cdn.test/a.jpg",
      Name: "a",
      AssetType: "Image",
      CallbackURL: "https://keep.me",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      GroupId: "group-1",
      URL: "https://cdn.test/a.jpg",
      Name: "a",
      AssetType: "Image",
      CallbackURL: "https://keep.me",
    });
  });

  it("NEW_API_BASE_URL 未配置抛 503", async () => {
    delete process.env.NEW_API_BASE_URL;
    stubFetch(() => json({}));
    const service = makeService();
    await expect(
      service.callAction(AUTH, "ListAssetGroups", {}),
    ).rejects.toBeInstanceOf(NewApiError);
    await expect(
      service.callAction(AUTH, "ListAssetGroups", {}),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("MaterialService —— ensureVirtualDefaultGroup（IKDE6X）", () => {
  const originalBaseUrl = process.env.NEW_API_BASE_URL;

  beforeEach(() => {
    process.env.NEW_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    if (originalBaseUrl === undefined) {
      delete process.env.NEW_API_BASE_URL;
    } else {
      process.env.NEW_API_BASE_URL = originalBaseUrl;
    }
    vi.unstubAllGlobals();
  });

  /** mock 本地 material_groups 查询：findVirtualDefault / upsert。upsert 默认 vi.fn 防 undefined。 */
  function makeGroupPrisma(overrides: {
    findVirtualDefault?: unknown;
    upsert?: unknown;
  } = {}) {
    const client = {
      material_groups: {
        findFirst: overrides.findVirtualDefault ?? vi.fn().mockResolvedValue(null),
        upsert: overrides.upsert ?? vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    return { prisma: { client } };
  }

  it("无虚拟默认组：调上游 CreateAssetGroup 建组（组名 默认分组：<uid>）并落本地 virtual 默认组", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-virt-1" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({
        id: 1n,
        user_id: 9n,
        material_group_id: "group-virt-1",
        kind: "virtual",
        name: "默认分组：9",
        cover_url: null,
        is_default: true,
      }),
    });
    const service = makeService(prisma as never);

    const groupId = await service.ensureVirtualDefaultGroup(AUTH, "9");

    expect(groupId).toBe("group-virt-1");
    // 上游建组：组名 默认分组：<uid>。
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://gateway.test/api/material/CreateAssetGroup");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ Name: "默认分组：9" });
    // 本地落表：virtual 默认组。
    expect(prisma.client.material_groups.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id_material_group_id: { user_id: 9n, material_group_id: "group-virt-1" },
        },
        create: expect.objectContaining({
          user_id: 9n,
          material_group_id: "group-virt-1",
          kind: "virtual",
          name: "默认分组：9",
          is_default: true,
        }),
      }),
    );
  });

  it("已有虚拟默认组：直接复用，不调上游、不落表", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "never" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue({
        id: 1n,
        user_id: 9n,
        material_group_id: "group-virt-1",
        kind: "virtual",
        name: "默认分组：9",
        cover_url: null,
        is_default: true,
      }),
    });
    const service = makeService(prisma as never);

    const groupId = await service.ensureVirtualDefaultGroup(AUTH, "9");

    expect(groupId).toBe("group-virt-1");
    expect(calls).toHaveLength(0); // 未调上游
    expect(prisma.client.material_groups.upsert).not.toHaveBeenCalled(); // 未落表
  });

  it("上游建组返回非 group- 前缀 Id：抛 502，不落表", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "bad-id" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup(AUTH, "9"),
    ).rejects.toMatchObject({ status: 502, code: "create_default_material_group_failed" });
    expect(calls).toHaveLength(1);
    expect(prisma.client.material_groups.upsert).not.toHaveBeenCalled();
  });

  it("上游建组 4xx：透传错误，不落表", async () => {
    const calls = stubFetch(() => json({ ResponseError: { Message: "nope" } }, 400));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup(AUTH, "9"),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
    expect(prisma.client.material_groups.upsert).not.toHaveBeenCalled();
  });

  it("上游建组成功但本地落表失败：补偿删除上游组并透传异常（契约 §2.2）", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-virt-1" } }));
    const { prisma } = makeGroupPrisma({
      findVirtualDefault: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const service = makeService(prisma as never);

    await expect(
      service.ensureVirtualDefaultGroup(AUTH, "9"),
    ).rejects.toThrow("db down");
    // 上游：先建组，再补偿删组。
    expect(calls[0].url).toBe("http://gateway.test/api/material/CreateAssetGroup");
    expect(calls[1].url).toBe("http://gateway.test/api/material/DeleteAssetGroup");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ Id: "group-virt-1" });
  });
});
