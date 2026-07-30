import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generationCredentialSecret: "generation-credential-secret",
  withAuthenticatedUser: vi.fn(
    async (
      _request: Request,
      handler: (user: {
        userId: string;
        status: "enabled";
      }) => Promise<Response> | Response,
    ) => handler({ userId: "42", status: "enabled" }),
  ),
  createGenerationCommandDeps: vi.fn(() => ({ command: {}, projects: {} })),
  createGenerationWorkerDeps: vi.fn(() => ({ repo: {}, provider: {} })),
  handleCreateGenerationJob: vi.fn(),
  processJob: vi.fn(),
  sealGenerationCredential: vi.fn(() => "sealed-token"),
  enqueueVideoGenerationJob: vi.fn(),
}));

vi.hoisted(() => {
  process.env.GENERATION_CREDENTIAL_SECRET = "generation-credential-secret";
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
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
vi.mock("@blue-whale/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blue-whale/core")>()),
  sealGenerationCredential: mocks.sealGenerationCredential,
}));
vi.mock("@/lib/generation/video-queue", () => ({
  enqueueVideoGenerationJob: mocks.enqueueVideoGenerationJob,
}));

import { POST } from "./route";

describe("POST project generation job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GENERATION_CREDENTIAL_SECRET = mocks.generationCredentialSecret;
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
      mocks.generationCredentialSecret,
    );
    expect(mocks.handleCreateGenerationJob).toHaveBeenCalledWith(
      "42",
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

  it("returns 503 before creating a video job when the credential secret is missing", async () => {
    delete process.env.GENERATION_CREDENTIAL_SECRET;

    const response = await POST(
      new Request("http://localhost/api/projects/55/generation-jobs", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "video" }),
      }),
      { params: Promise.resolve({ id: "55" }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 503,
      msg: "生成服务暂不可用",
      data: null,
    });
    expect(mocks.sealGenerationCredential).not.toHaveBeenCalled();
    expect(mocks.handleCreateGenerationJob).not.toHaveBeenCalled();
  });

  it("returns the authentication adapter's 503 response unchanged", async () => {
    mocks.withAuthenticatedUser.mockResolvedValueOnce(
      Response.json(
        { code: 503, msg: "账户服务暂不可用", data: null },
        { status: 503 },
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/projects/55/generation-jobs", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "video" }),
      }),
      { params: Promise.resolve({ id: "55" }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 503,
      msg: "账户服务暂不可用",
      data: null,
    });
    expect(mocks.handleCreateGenerationJob).not.toHaveBeenCalled();
    expect(mocks.sealGenerationCredential).not.toHaveBeenCalled();
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
