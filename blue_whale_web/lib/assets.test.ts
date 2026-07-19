import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "./api";
import { copyAssetToProject } from "./assets";

vi.mock("./api", () => ({ request: vi.fn() }));

describe("Assets API", () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it("添加到项目：POST /api/projects/{id}/assets 携带 source_asset_id 与 Idempotency-Key", async () => {
    vi.mocked(request).mockResolvedValue({
      id: 101,
      type: "image",
      url: "/assets/101/content",
      width: 1024,
      height: 1024,
      duration: null,
      source: "generated",
      created_at: "2026-07-19T10:00:00Z",
    });

    const result = await copyAssetToProject(77, 9, "cmd-1");

    expect(request).toHaveBeenCalledWith(
      "/projects/77/assets",
      "POST",
      { source_asset_id: 9 },
      { "Idempotency-Key": "cmd-1" },
    );
    expect(result.id).toBe(101);
  });
});
