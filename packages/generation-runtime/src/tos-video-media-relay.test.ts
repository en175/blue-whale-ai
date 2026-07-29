import { describe, expect, it, vi } from "vitest";

describe("TOS video media relay", () => {
  it("uploads provider bytes, makes the object public, and returns its public URL", async () => {
    const module = await import("./tos-video-media-relay.js").catch(() => ({}));
    const createRelay = (module as {
      createTosVideoMediaRelay?: (
        config: Record<string, unknown>,
        deps: Record<string, unknown>,
      ) => { persist(sourceUrl: string, userId: string): Promise<unknown> };
    }).createTosVideoMediaRelay;

    expect(createRelay).toBeTypeOf("function");
    if (!createRelay) return;

    const client = {
      getPreSignedUrl: vi.fn().mockReturnValue("https://tos.test/signed-put"),
      putObjectAcl: vi.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("video-bytes", {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const relay = createRelay(
      {
        accessKeyId: "ak-test",
        secretAccessKey: "sk-test",
        endpoint: "tos-cn-beijing.volces.com",
        bucket: "bluewhale-assets",
        region: "cn-beijing",
      },
      {
        client,
        fetchImpl,
        randomUUID: () => "fixed-id",
      },
    );

    await expect(
      relay.persist("https://provider.test/result.mp4", "9"),
    ).resolves.toEqual({
      url: "https://bluewhale-assets.tos-cn-beijing.volces.com/generated/9/video/fixedid.mp4",
      storageKey: "generated/9/video/fixedid.mp4",
      mime: "video/mp4",
      size: 11,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://tos.test/signed-put",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "video/mp4" },
      }),
    );
    expect(client.putObjectAcl).toHaveBeenCalledWith({
      bucket: "bluewhale-assets",
      key: "generated/9/video/fixedid.mp4",
      acl: "public-read",
    });
  });
});
