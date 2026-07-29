// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { completeAsset, presignAsset } from "./endpoints";

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, msg: null, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("asset upload endpoints", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("bw-access-token", "sk-upload-user");
  });

  it("presign uses the Node route with the current sk token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      envelope({
        storage_key: "uploads/9/image/fixed.png",
        upload_url: "https://tos.test/upload",
        headers: { "Content-Type": "image/png" },
        expires_in: 600,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await presignAsset({
      type: "image",
      mime: "image/png",
      size: 1024,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agent/assets/uploads/presign");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer sk-upload-user",
    );
    expect(result.storage_key).toBe("uploads/9/image/fixed.png");
  });

  it("complete uses the authenticated Node route and unwraps the Result envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      envelope({
        asset_id: "41",
        status: "ready",
        type: "image",
        url: "https://tos.test/file.png",
        width: 0,
        height: 0,
        duration: null,
        mime: "image/png",
        size: 1024,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await completeAsset({
      project_id: "55",
      type: "image",
      mime: "image/png",
      size: 1024,
      storage_key: "uploads/9/image/fixed.png",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agent/assets/uploads/complete");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer sk-upload-user",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      project_id: "55",
      type: "image",
      mime: "image/png",
      size: 1024,
      storage_key: "uploads/9/image/fixed.png",
    });
    expect(result.status).toBe("ready");
  });
});
