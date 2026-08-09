import {
  RESOURCE_NOT_FOUND_CODE,
  SCENE_CARD_VERSION_CONFLICT_CODE,
} from "@blue-whale/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  handleDeleteSceneCardResource,
  handleGetSceneCardResource,
} from "./handle-scene-card-resource";

describe("SceneCard 资源 GET/DELETE", () => {
  it("GET 返回服务端 ETag，客户端无需自行拼版本", async () => {
    const getSceneCardResource = vi.fn().mockResolvedValue({
      kind: "found",
      scene_card_id: "5001",
      project_id: "42",
      title: "海边开场",
      summary: null,
      content_markdown: "# 开场",
      version: 3,
    });

    await expect(
      handleGetSceneCardResource("100", "5001", {
        getSceneCardResource,
      } as never),
    ).resolves.toMatchObject({
      status: 200,
      etag: '"3"',
      body: {
        code: 200,
        data: { scene_card_id: 5001, version: 3 },
      },
    });
  });

  it("DELETE 校验 If-Match 并把 Idempotency-Key 传入原子删除", async () => {
    const deleteSceneCardResource = vi
      .fn()
      .mockResolvedValue({ kind: "deleted" });

    await expect(
      handleDeleteSceneCardResource("100", "5001", '"3"', "delete-1", {
        deleteSceneCardResource,
      } as never),
    ).resolves.toEqual({ status: 204 });
    expect(deleteSceneCardResource).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "100",
        sceneCardId: "5001",
        expectedVersion: 3,
        idempotencyKey: "delete-1",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("DELETE 缺 If-Match 返回 428，且不触发写入", async () => {
    const deleteSceneCardResource = vi.fn();

    const result = await handleDeleteSceneCardResource(
      "100",
      "5001",
      null,
      "delete-1",
      { deleteSceneCardResource } as never,
    );

    expect(result.status).toBe(428);
    expect(deleteSceneCardResource).not.toHaveBeenCalled();
  });

  it("DELETE 的 If-Match 过期映射 HTTP 412", async () => {
    const result = await handleDeleteSceneCardResource(
      "100",
      "5001",
      '"3"',
      "delete-1",
      {
        deleteSceneCardResource: vi.fn().mockResolvedValue({
          kind: "version_conflict",
          current_version: 4,
        }),
      } as never,
    );

    expect(result.status).toBe(412);
    expect(result.body?.code).toBe(SCENE_CARD_VERSION_CONFLICT_CODE);
  });

  it("越权删除他人资源映射 404，不泄漏存在性", async () => {
    const result = await handleDeleteSceneCardResource(
      "200",
      "5001",
      '"3"',
      "delete-1",
      {
        deleteSceneCardResource: vi.fn().mockResolvedValue({
          kind: "not_found",
        }),
      } as never,
    );

    expect(result.status).toBe(404);
    expect(result.body?.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("越权读取他人资源映射 404，不泄漏存在性", async () => {
    const result = await handleGetSceneCardResource("200", "5001", {
      getSceneCardResource: vi.fn().mockResolvedValue({ kind: "not_found" }),
    } as never);

    expect(result.status).toBe(404);
    expect(result.body?.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });
});
