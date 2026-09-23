import { describe, expect, it, vi } from "vitest";
import { AudioMixesService } from "./audio-mixes.service.js";

const input = {
  source_node_id: "node-source",
  inputs: [
    { asset_id: "11", node_id: "node-source" },
    { asset_id: "12" },
  ],
};

function makeService(assetsById: Record<string, object> = {
  "11": { id: 11n, project_id: 5n, type: "audio", url: "https://tos.example/11.mp3", storage_key: "11.mp3" },
  "12": { id: 12n, project_id: 0n, type: "audio", url: "https://tos.example/12.mp3", storage_key: "12.mp3" },
}) {
  const create = vi.fn().mockResolvedValue({ id: 70n });
  const prisma = { client: { generation_jobs: { create }, project_asset: { findMany: vi.fn().mockResolvedValue([]) } } };
  const project = { findOwnedById: vi.fn().mockResolvedValue({ id: 5n }) };
  const assets = { findOwnedSource: vi.fn().mockImplementation(async (id: string) => assetsById[id] ?? null) };
  return { service: new AudioMixesService(prisma as never, project as never, assets as never), create, project, assets };
}

describe("AudioMixesService.create", () => {
  it("freezes ordered audio identities and server-resolved URLs with an explicit MP3 default", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "5", input, { providerCredential: "sk-live" });
    expect(result).toMatchObject({ code: 200, data: { job_id: "70", status: "queued" } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: "audio_mix", status: "queued", user_id: 9n, project_id: 5n,
      input: {
        source_node_id: "node-source", output_format: "mp3", provider_credential: "sk-live",
        inputs: [
          { asset_id: "11", node_id: "node-source", url: "https://tos.example/11.mp3" },
          { asset_id: "12", url: "https://tos.example/12.mp3" },
        ],
      },
    }) });
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
