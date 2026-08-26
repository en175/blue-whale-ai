import { describe, expect, it } from "vitest";

import { NewApiError } from "./new-api-transport.js";
import { createMaterialLibraryClient } from "./material-library-client.js";
import { jsonResponse } from "./new-api-client.testlib.js";

describe("material-library client —— 纯过境传输", () => {
  it("2xx 信封原样透传（Result/ResponseMetadata 不改写）", async () => {
    const envelope = {
      ResponseMetadata: { RequestId: "req_1", Action: "ListAssets" },
      Result: { TotalCount: 1, Items: [{ Id: "Asset-x" }] },
    };
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createMaterialLibraryClient({
      baseUrl: "http://gateway.test/",
      fetchImpl: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return jsonResponse(envelope);
      },
    });

    const res = await client.callAction(
      "ListAssets",
      { Filter: { GroupIds: ["group-1"] }, PageNumber: 1, PageSize: 10 },
      "sk-test",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(envelope);

    const { url, init } = requests[0];
    expect(url).toBe("http://gateway.test/api/material/ListAssets");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk-test");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Trace-Id")).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({
      Filter: { GroupIds: ["group-1"] },
      PageNumber: 1,
      PageSize: 10,
    });
  });

  it("非 2xx 的 ResponseError 原样透传（不抛错、不改状态码）", async () => {
    const errorBody = {
      ResponseMetadata: { RequestId: "req_2", Action: "GetAsset" },
      ResponseError: { Code: "NotFound", Message: "resource not found" },
    };
    const client = createMaterialLibraryClient({
      baseUrl: "http://gateway.test",
      fetchImpl: async () => jsonResponse(errorBody, 404),
    });

    const res = await client.callAction("GetAsset", { Id: "Asset-nope" }, "sk-test");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(errorBody);
  });

  it("真人会话类直接格式（无信封）同样原样透传", async () => {
    const direct = { BytedToken: "bt-1", H5Link: "https://h5.test/verify" };
    const client = createMaterialLibraryClient({
      baseUrl: "http://gateway.test",
      fetchImpl: async () => jsonResponse(direct),
    });
    const res = await client.callAction(
      "CreateVisualValidateSession",
      { Name: "真人组" },
      "sk-test",
    );
    expect(res).toEqual({ status: 200, body: direct });
  });

  it("网关不可达抛 503 NewApiError", async () => {
    const client = createMaterialLibraryClient({
      baseUrl: "http://gateway.test",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const promise = client.callAction("ListAssetGroups", {}, "sk-test");
    await expect(promise).rejects.toMatchObject({
      status: 503,
      message: "素材库服务不可达",
    });
    await expect(promise).rejects.toBeInstanceOf(NewApiError);
  });

  it("非法 Action 名拒绝（防路径注入），不发请求", async () => {
    let called = false;
    const client = createMaterialLibraryClient({
      baseUrl: "http://gateway.test",
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    await expect(
      client.callAction("../admin", {}, "sk-test"),
    ).rejects.toMatchObject({ status: 400 });
    expect(called).toBe(false);
  });

  it("body 缺省发送空对象", async () => {
    let sentBody: unknown;
    const client = createMaterialLibraryClient({
      baseUrl: "http://gateway.test",
      fetchImpl: async (_input, init = {}) => {
        sentBody = JSON.parse(String(init.body));
        return jsonResponse({});
      },
    });
    await client.callAction("DeleteAssetGroup", undefined, "sk-test");
    expect(sentBody).toEqual({});
  });
});
