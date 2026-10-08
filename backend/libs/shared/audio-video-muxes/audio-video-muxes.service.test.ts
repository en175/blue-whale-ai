import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioVideoMuxesService } from "./audio-video-muxes.service.js";

const input = {
  audio: { assetId: "11", nodeId: "node-audio" },
  video: { assetId: "12" },
};

function makeService(assetsById: Record<string, object> = {
  "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3", duration_ms: 10_000 },
  "12": { id: 12n, project_id: 0n, type: "video", url: "https://tos.example/12.mp4", storage_key: "12.mp4", duration_ms: 12_500 },
}) {
  const create = vi.fn().mockResolvedValue({ id: 70n });
  const prisma = { client: { generation_jobs: { create }, project_asset: { findMany: vi.fn().mockResolvedValue([]) } } };
  const project = { findOwnedById: vi.fn().mockResolvedValue({ id: 5n }) };
  const assets = { findOwnedSource: vi.fn().mockImplementation(async (id: string) => assetsById[id] ?? null) };
  const inspectObject = vi.fn().mockImplementation(async (key: string) => ({
    size: 100, mime: "video/mp4", publicUrl: `https://public-tos.example/${key}`,
  }));
  const storage = { uploads: { inspectObject } };
  const publicFetch = vi.fn().mockResolvedValue({ ok: true, body: { cancel: vi.fn() } });
  vi.stubGlobal("fetch", publicFetch);
  return {
    service: new AudioVideoMuxesService(prisma as never, project as never, assets as never, storage as never),
    create, project, assets, inspectObject, publicFetch,
  };
}

describe("AudioVideoMuxesService.create", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("freezes camel identities, explicit defaults and server-resolved URLs with the video duration", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "5", input);
    expect(result).toMatchObject({ code: 200, data: { job_id: "70", status: "queued", enqueue_required: true } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: "audio_video_mux", source: "dock", status: "queued", user_id: 9n, project_id: 5n,
      input: {
        audio: { assetId: "11", nodeId: "node-audio", url: "https://public-tos.example/11.mp3" },
        video: { assetId: "12", url: "https://public-tos.example/12.mp4" },
        is_audio_reserve: true,
        sync: "none",
        estimated_duration_ms: 12_500,
        submit_attempt: 1,
      },
    }) });
  });

  it("freezes the explicit parameter tier without inventing a video node id", async () => {
    const { service, create } = makeService();
    await service.create("9", "5", {
      audio: { assetId: "11", nodeId: "node-audio" },
      video: { assetId: "12", nodeId: "node-video" },
      is_audio_reserve: false,
      sync: "video",
    });
    expect(create.mock.calls[0][0].data.input).toMatchObject({
      video: { assetId: "12", nodeId: "node-video", url: "https://public-tos.example/12.mp4" },
      is_audio_reserve: false,
      sync: "video",
    });
  });

  it("takes the estimated duration from the source video asset only, unknown stays null", async () => {
    const { service, create } = makeService({
      "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3", duration_ms: 99_000 },
      "12": { id: 12n, project_id: 0n, type: "video", url: "https://tos.example/12.mp4", storage_key: "12.mp4", duration_ms: null },
    });
    await service.create("9", "5", input);
    expect(create.mock.calls[0][0].data.input.estimated_duration_ms).toBeNull();
  });

  it("keeps each media type in its own slot", async () => {
    const { service, create } = makeService({
      "11": { id: 11n, project_id: 5n, type: "video", url: "https://tos.example/11.mp3", storage_key: "11.mp3" },
      "12": { id: 12n, project_id: 0n, type: "video", url: "https://tos.example/12.mp4", storage_key: "12.mp4" },
    });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it("resolves each slot from a real object and checks a public ranged GET", async () => {
    const { service, inspectObject, publicFetch } = makeService();
    await service.create("9", "5", input);
    expect(inspectObject).toHaveBeenCalledWith("11.mp3");
    expect(inspectObject).toHaveBeenCalledWith("12.mp4");
    expect(publicFetch).toHaveBeenCalledWith("https://public-tos.example/12.mp4", expect.objectContaining({
      method: "GET", headers: { Range: "bytes=0-0" },
    }));
  });

  it("resolves legacy keyless TOS assets and refuses URLs outside our bucket", async () => {
    vi.stubEnv("VOLC_ACCESS_KEY_ID", "test");
    vi.stubEnv("VOLC_SECRET_ACCESS_KEY", "test");
    vi.stubEnv("VOLC_TOS_ENDPOINT", "tos.example");
    vi.stubEnv("VOLC_TOS_BUCKET", "our-bucket");
    vi.stubEnv("VOLC_TOS_REGION", "test");
    const { service, inspectObject } = makeService({
      "11": { project_id: 5n, type: "audio", url: "https://our-bucket.tos.example/generated/9/audio/a.mp3", storage_key: null },
      "12": { project_id: 0n, type: "video", url: "https://our-bucket.tos.example/generated/9/video/b.mp4", storage_key: null },
    });
    await service.create("9", "5", input);
    expect(inspectObject.mock.calls.map(([key]) => key)).toEqual([
      "generated/9/audio/a.mp3", "generated/9/video/b.mp4",
    ]);

    const { service: blocked, inspectObject: blockedProbe, create: blockedCreate } = makeService({
      "11": { project_id: 5n, type: "audio", url: "https://evil.example/private", storage_key: null },
      "12": { project_id: 0n, type: "video", url: "https://our-bucket.tos.example/generated/9/video/b.mp4", storage_key: null },
    });
    await expect(blocked.create("9", "5", input)).rejects.toMatchObject({ status: 400 });
    expect(blockedProbe).not.toHaveBeenCalledWith("private");
    expect(blockedCreate).not.toHaveBeenCalled();
  });

  it("caps the entire object-validation window at 15 seconds", async () => {
    vi.useFakeTimers();
    const { service, inspectObject, create } = makeService();
    inspectObject.mockImplementation(() => new Promise(() => {}));
    const rejected = expect(service.create("9", "5", input)).rejects.toMatchObject({ status: 400 });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["wrong media type", { id: 12n, type: "audio", url: "https://tos.example/12.mp3", storage_key: "12.mp3" }],
    ["temporary URL", { id: 12n, type: "video", url: "blob:browser", storage_key: "12.mp4" }],
    ["no stored object", { id: 12n, type: "video", url: "https://tos.example/12.mp4", storage_key: null }],
    // 契约 §21.1 冻结白名单（https/mediakit/vod/tos）不含 http：即使 storage_key 存在、
    // 桶对象本身可公开读取，http URL 也在入口拒绝（收紧自照抄 audio-mix 的 https?: 前置）。
    ["plain http URL outside the frozen allowlist", { id: 12n, type: "video", url: "http://tos.example/12.mp4", storage_key: "12.mp4" }],
  ])("rejects %s video inputs with no persisted job", async (_reason, second) => {
    const { service, create, inspectObject } = makeService({
      "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3" },
      "12": { project_id: 0n, ...second },
    });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ status: expect.any(Number) });
    expect(create).not.toHaveBeenCalled();
    if (_reason.startsWith("plain http")) expect(inspectObject).not.toHaveBeenCalledWith("12.mp4");
  });

  it("rejects a stored object whose public URL cannot be read by the gateway", async () => {
    const { service, create, publicFetch } = makeService();
    publicFetch.mockResolvedValueOnce({ ok: false, status: 403, body: { cancel: vi.fn() } });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an owned asset belonging to another project without an explicit link", async () => {
    const { service, create } = makeService({
      "11": { id: 11n, project_id: 6n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3" },
      "12": { id: 12n, project_id: 0n, type: "video", url: "https://tos.example/12.mp4", storage_key: "12.mp4" },
    });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ code: 100301, status: 404 });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["snake case", { audio: { asset_id: "11", node_id: "node-audio" }, video: { asset_id: "12" } }],
    ["audio without node", { audio: { assetId: "11" }, video: { assetId: "12" } }],
    ["unsupported sync", { audio: { assetId: "11", nodeId: "node-audio" }, video: { assetId: "12" }, sync: "speed" }],
  ])("rejects %s request bodies before probing anything", async (_reason, body) => {
    const { service, create, inspectObject } = makeService();
    await expect(service.create("9", "5", body)).rejects.toMatchObject({ code: 100000, status: 400 });
    expect(inspectObject).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("derives the execution deadline from the video estimate with the frozen budget formula", async () => {
    const { service, create } = makeService({
      "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3" },
      "12": { id: 12n, project_id: 0n, type: "video", url: "https://tos.example/12.mp4", storage_key: "12.mp4", duration_ms: 20 * 60 * 60 * 1000 },
    });
    const before = Date.now();
    await service.create("9", "5", input);
    const deadline = create.mock.calls[0][0].data.execution_deadline_at as Date;
    const day = 24 * 60 * 60 * 1000;
    const expected = 20 * 60 * 60 * 1000 * 4 + 6 * 60 * 60 * 1000;
    expect(deadline.getTime()).toBeGreaterThanOrEqual(before + expected);
    expect(deadline.getTime()).toBeLessThanOrEqual(Date.now() + expected);
    expect(expected).toBeGreaterThan(day);
  });
});
