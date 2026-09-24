import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioMixesService } from "./audio-mixes.service.js";

const input = {
  source_node_id: "node-source",
  inputs: [
    { asset_id: "11", node_id: "node-source" },
    { asset_id: "12" },
  ],
};

function makeService(assetsById: Record<string, object> = {
  "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3", duration_ms: 10_000 },
  "12": { id: 12n, project_id: 0n, type: "audio", url: "https://tos.example/12.mp3", storage_key: "12.mp3", duration_ms: 12_500 },
}) {
  const create = vi.fn().mockResolvedValue({ id: 70n });
  const prisma = { client: { generation_jobs: { create }, project_asset: { findMany: vi.fn().mockResolvedValue([]) } } };
  const project = { findOwnedById: vi.fn().mockResolvedValue({ id: 5n }) };
  const assets = { findOwnedSource: vi.fn().mockImplementation(async (id: string) => assetsById[id] ?? null) };
  const inspectObject = vi.fn().mockImplementation(async (key: string) => ({
    size: 100, mime: "audio/mpeg", publicUrl: `https://public-tos.example/${key}`,
  }));
  const storage = { uploads: { inspectObject } };
  const publicFetch = vi.fn().mockResolvedValue({ ok: true, body: { cancel: vi.fn() } });
  vi.stubGlobal("fetch", publicFetch);
  return {
    service: new AudioMixesService(prisma as never, project as never, assets as never, storage as never),
    create, project, assets, inspectObject, publicFetch,
  };
}

describe("AudioMixesService.create", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("freezes ordered audio identities and server-resolved URLs with an explicit MP3 default", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "5", input, { providerCredential: "sk-live" });
    expect(result).toMatchObject({ code: 200, data: { job_id: "70", status: "queued" } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: "audio_mix", status: "queued", user_id: 9n, project_id: 5n,
      input: {
        source_node_id: "node-source", output_format: "mp3", provider_credential: "sk-live",
        estimated_duration_ms: 12_500,
        inputs: [
          { asset_id: "11", node_id: "node-source", url: "https://public-tos.example/11.mp3" },
          { asset_id: "12", url: "https://public-tos.example/12.mp3" },
        ],
      },
    }) });
  });

  it("freezes unknown estimated duration as null rather than guessing", async () => {
    const { service, create } = makeService({
      "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3", duration_ms: 10_000 },
      "12": { id: 12n, project_id: 0n, type: "audio", url: "https://tos.example/12.mp3", storage_key: "12.mp3", duration_ms: null },
    });
    await service.create("9", "5", input);
    expect(create.mock.calls[0][0].data.input.estimated_duration_ms).toBeNull();
  });

  it("resolves each input from a real object and checks a public ranged GET", async () => {
    const { service, inspectObject, publicFetch } = makeService();
    await service.create("9", "5", input);
    expect(inspectObject).toHaveBeenCalledWith("11.mp3");
    expect(inspectObject).toHaveBeenCalledWith("12.mp3");
    expect(publicFetch).toHaveBeenCalledWith("https://public-tos.example/11.mp3", expect.objectContaining({
      method: "GET", headers: { Range: "bytes=0-0" },
    }));
  });

  it("supports completed uploaded and generated audio objects", async () => {
    const { service, inspectObject } = makeService({
      "11": { project_id: 5n, type: "audio", url: "https://tos.example/uploads/9/audio/a.mp3", storage_key: "uploads/9/audio/a.mp3", duration_ms: 10_000 },
      "12": { project_id: 0n, type: "audio", url: "https://tos.example/generated/9/audio/b.mp3", storage_key: "generated/9/audio/b.mp3", duration_ms: 12_500 },
    });
    await service.create("9", "5", input);
    expect(inspectObject.mock.calls.map(([key]) => key)).toEqual([
      "uploads/9/audio/a.mp3", "generated/9/audio/b.mp3",
    ]);
  });

  it("resolves a legacy completed TOS asset whose storage_key was not recorded", async () => {
    vi.stubEnv("VOLC_ACCESS_KEY_ID", "test");
    vi.stubEnv("VOLC_SECRET_ACCESS_KEY", "test");
    vi.stubEnv("VOLC_TOS_ENDPOINT", "tos.example");
    vi.stubEnv("VOLC_TOS_BUCKET", "our-bucket");
    vi.stubEnv("VOLC_TOS_REGION", "test");
    const { service, inspectObject } = makeService({
      "11": { project_id: 5n, type: "audio", url: "https://our-bucket.tos.example/generated/9/audio/a.mp3", storage_key: null },
      "12": { project_id: 0n, type: "audio", url: "https://our-bucket.tos.example/generated/9/audio/b.mp3", storage_key: null },
    });
    await service.create("9", "5", input);
    expect(inspectObject.mock.calls.map(([key]) => key)).toEqual([
      "generated/9/audio/a.mp3", "generated/9/audio/b.mp3",
    ]);
  });

  it("does not probe a keyless asset URL outside the configured TOS bucket", async () => {
    vi.stubEnv("VOLC_ACCESS_KEY_ID", "test");
    vi.stubEnv("VOLC_SECRET_ACCESS_KEY", "test");
    vi.stubEnv("VOLC_TOS_ENDPOINT", "tos.example");
    vi.stubEnv("VOLC_TOS_BUCKET", "our-bucket");
    vi.stubEnv("VOLC_TOS_REGION", "test");
    const { service, inspectObject, create } = makeService({
      "11": { project_id: 5n, type: "audio", url: "https://evil.example/private", storage_key: null },
    });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ status: 400 });
    expect(inspectObject).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("limits concurrent object checks while preserving the order of 100 inputs", async () => {
    const assets = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i + 1), {
      project_id: 5n, type: "audio", url: `https://tos.example/${i + 1}.mp3`, storage_key: `${i + 1}.mp3`,
    }]));
    const { service, inspectObject, create } = makeService(assets);
    let active = 0;
    let peak = 0;
    inspectObject.mockImplementation(async (key: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return { size: 100, publicUrl: `https://public-tos.example/${key}` };
    });
    await service.create("9", "5", {
      source_node_id: "node-source",
      inputs: Array.from({ length: 100 }, (_, i) => ({ asset_id: String(i + 1), ...(i === 0 ? { node_id: "node-source" } : {}) })),
    });
    expect(peak).toBeLessThanOrEqual(8);
    expect(create.mock.calls[0][0].data.input.inputs.map((item: { asset_id: string }) => item.asset_id))
      .toEqual(Array.from({ length: 100 }, (_, i) => String(i + 1)));
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

  it("rejects a missing object before persisting a job", async () => {
    const { service, create, inspectObject } = makeService();
    inspectObject.mockResolvedValueOnce(null);
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a stored object whose public URL cannot be read by the gateway", async () => {
    const { service, create, publicFetch } = makeService();
    publicFetch.mockResolvedValueOnce({ ok: false, status: 403, body: { cancel: vi.fn() } });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([1, 101])("rejects %i inputs before creating a job", async (count) => {
    const { service, create } = makeService();
    await expect(service.create("9", "5", { ...input, inputs: Array.from({ length: count }, (_, i) => ({ asset_id: String(i + 1) })) }))
      .rejects.toMatchObject({ code: 100000, status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate asset across canvas and library entries", async () => {
    const { service, create } = makeService();
    await expect(service.create("9", "5", { ...input, inputs: [{ asset_id: "11", node_id: "node-source" }, { asset_id: "11" }] }))
      .rejects.toMatchObject({ code: 100000, status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an owned asset belonging to another project without an explicit link", async () => {
    const { service, create } = makeService({
      "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3" },
      "12": { id: 12n, project_id: 6n, type: "audio", url: "https://tos.example/12.mp3", storage_key: "12.mp3" },
    });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ code: 100301, status: 404 });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a first input whose node differs from the fixed source node", async () => {
    const { service, create } = makeService();
    await expect(service.create("9", "5", { ...input, source_node_id: "another-node" }))
      .rejects.toMatchObject({ code: 100000, status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["not audio", { id: 12n, type: "video", url: "https://tos.example/12.mp3", storage_key: "12.mp3" }],
    ["temporary URL", { id: 12n, type: "audio", url: "blob:browser", storage_key: "12.mp3" }],
    ["no stored object", { id: 12n, type: "audio", url: "https://tos.example/12.mp3", storage_key: null }],
  ])("rejects %s inputs with no persisted job", async (_reason, second) => {
    const { service, create } = makeService({ "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3" }, "12": { project_id: 0n, ...second } });
    await expect(service.create("9", "5", input)).rejects.toMatchObject({ status: expect.any(Number) });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["mp3", "m4a", "ogg", "flac", "wav"])("accepts output format %s", async (format) => {
    const { service, create } = makeService();
    expect((await service.create("9", "5", { ...input, output_format: format })).code).toBe(200);
    expect(create.mock.calls[0][0].data.input.output_format).toBe(format);
  });

  it("rejects an unsupported format", async () => {
    const { service, create } = makeService();
    await expect(service.create("9", "5", { ...input, output_format: "aac" }))
      .rejects.toMatchObject({ code: 100000, status: 400 });
    expect(create).not.toHaveBeenCalled();
  });
});
