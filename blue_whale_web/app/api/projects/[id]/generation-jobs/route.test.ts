import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserIdFromRequest: vi.fn(),
  createGenerationCommandDeps: vi.fn(() => ({ command: {}, projects: {} })),
  createGenerationWorkerDeps: vi.fn(() => ({ repo: {}, provider: {} })),
  handleCreateGenerationJob: vi.fn(),
  processJob: vi.fn(),
  sealGenerationCredential: vi.fn(() => "sealed-token"),
  enqueueVideoGenerationJob: vi.fn(),
}));

vi.mock("@/lib/auth/user-from-request", () => ({
  getUserIdFromRequest: mocks.getUserIdFromRequest,
}));
vi.mock("@/lib/generation/deps", () => ({
  createGenerationCommandDeps: mocks.createGenerationCommandDeps,
  createGenerationWorkerDeps: mocks.createGenerationWorkerDeps,
}));
vi.mock("@/lib/generation/handle-create-generation-job", () => ({
  handleCreateGenerationJob: mocks.handleCreateGenerationJob,
}));
vi.mock("@/lib/generation/worker/generation-worker", () => ({
  processJob: mocks.processJob,
}));
vi.mock("@blue-whale/core", () => ({
  sealGenerationCredential: mocks.sealGenerationCredential,
}));
vi.mock("@/lib/generation/video-queue", () => ({
  enqueueVideoGenerationJob: mocks.enqueueVideoGenerationJob,
}));

import { POST } from "./route";

describe("POST project generation job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserIdFromRequest.mockResolvedValue("9");
    mocks.handleCreateGenerationJob.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { generation_job_id: "300", cursor: 0 },
    });
  });

  it("queues video with an encrypted provider credential and does not run it in the request", async () => {
    const body = {
      type: "video",
      input_asset_ids: [],
      expected_output_count: 1,
      parameters: {
        prompt: "鲸鱼游动",
        model_id: "seedance-2",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 5,
      },
    };
    const response = await POST(
      new Request("http://localhost/api/projects/55/generation-jobs", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "55" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.sealGenerationCredential).toHaveBeenCalledWith(
      "sk-user-secret",
      expect.any(String),
    );
    expect(mocks.handleCreateGenerationJob).toHaveBeenCalledWith(
      "9",
      "55",
      body,
      null,
      expect.any(Object),
      { providerCredential: "sealed-token" },
    );
    expect(mocks.createGenerationWorkerDeps).not.toHaveBeenCalled();
    expect(mocks.processJob).not.toHaveBeenCalled();
    expect(mocks.enqueueVideoGenerationJob).toHaveBeenCalledWith("300");
  });

  it("keeps the durable job accepted when Redis enqueue fails", async () => {
    mocks.enqueueVideoGenerationJob.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    const response = await POST(
      new Request("http://localhost/api/projects/55/generation-jobs", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "video",
          input_asset_ids: [],
          expected_output_count: 1,
          parameters: {
            prompt: "鲸鱼游动",
            model_id: "seedance-2",
            aspect_ratio: "16:9",
            resolution: "720p",
            duration: 5,
          },
        }),
      }),
      { params: Promise.resolve({ id: "55" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: { generation_job_id: "300" },
    });
  });
});
