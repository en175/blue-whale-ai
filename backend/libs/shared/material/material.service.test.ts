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
    const service = new MaterialService();
    await expect(
      service.callAction(AUTH, "GetModerationResult", {}),
    ).rejects.toMatchObject({ status: 400, code: "InvalidAction" });
    expect(calls).toHaveLength(0);
  });

  it("缺少上游执行凭证拒绝（401）", async () => {
    stubFetch(() => json({}));
    const service = new MaterialService();
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
    const service = new MaterialService();
    const res = await service.callAction(AUTH, "GetAsset", { Id: "Asset-x" });
    expect(res).toEqual({ status: 404, body: errorBody });
  });

  it("请求以 Bearer sk- 打网关 /api/material/{Action}", async () => {
    const calls = stubFetch(() => json({ Result: { Id: "group-1" } }));
    const service = new MaterialService();
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
    const service = new MaterialService();
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
    const service = new MaterialService();
    await service.callAction(AUTH, "CreateVisualValidateSession", {
      Name: "真人组",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      Name: "真人组",
    });
  });

  it("其他 Action 请求体原样透传（含任意自定义字段）", async () => {
    const calls = stubFetch(() => json({ Result: {} }));
    const service = new MaterialService();
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
    const service = new MaterialService();
    await expect(
      service.callAction(AUTH, "ListAssetGroups", {}),
    ).rejects.toBeInstanceOf(NewApiError);
    await expect(
      service.callAction(AUTH, "ListAssetGroups", {}),
    ).rejects.toMatchObject({ status: 503 });
  });
});
