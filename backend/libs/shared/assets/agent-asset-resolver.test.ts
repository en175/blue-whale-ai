import { describe, expect, it, vi } from "vitest";
import {
  agentAssetResolveRequestSchema,
  resolveAgentAsset,
  type AgentReadableAsset,
} from "./agent-asset-resolver.js";

const asset: AgentReadableAsset = {
  storage_key: "uploads/7/image/immutable.png",
  type: "image",
  mime: "image/png",
  size: 1_048_576n,
  duration_seconds: null,
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    findAccessible: vi.fn().mockResolvedValue(asset),
    // 两种签法给两条不同的地址：区分得开，「探测拿到的是哪一条」才是可断言的（IKE53N）。
    sign: vi
      .fn()
      .mockImplementation(
        async (_key: string, options?: { forModelReading?: boolean }) => ({
          url: options?.forModelReading
            ? "https://assets.example.test/read?x-tos-process=resize&signature=secret"
            : "https://assets.example.test/read?signature=secret",
          expiresAt: new Date("2026-08-17T08:00:00.000Z"),
        }),
      ),
    ...overrides,
  };
}

describe("resolveAgentAsset", () => {
  it("rechecks the owner tuple and returns authoritative transient metadata", async () => {
    const current = deps();
    const outcome = await resolveAgentAsset(
      { asset_id: "123" },
      { userId: "7", projectId: "9" },
      current,
    );

    expect(current.findAccessible).toHaveBeenCalledWith("9", "123", "7");
    expect(outcome).toEqual({
      kind: "ok",
      value: {
        asset_id: "123",
        media_type: "image",
        // 图片签的是给模型读的降采样版本，那一版是 JPEG（IKAZC2）。报原始的 image/png 会让
        // 下游按错误的类型处理——mime_type 与 read_url 说的必须是同一份字节。
        mime_type: "image/jpeg",
        // 仍是原图大小：媒体策略用它守素材本身是否荒唐，不是守本次传输量。
        size_bytes: 1_048_576,
        duration_seconds: null,
        read_url:
          "https://assets.example.test/read?x-tos-process=resize&signature=secret",
        // 探测那一条不带处理参数：它要读的是用户上传的字节本身（IKE53N）。
        probe_url: "https://assets.example.test/read?signature=secret",
        expires_at: "2026-08-17T08:00:00.000Z",
      },
    });
  });

  /**
   * IKAZC2：图片要签成给模型读的降采样版本。
   *
   * 线上那次失败是这样发生的：8.27MB 的 PNG 交给 AI SDK，SDK 因为 provider 未声明支持该 URL
   * 而自己下载、base64 内联，约 11MB 的请求体被链路上的 body 上限挡下，用户看到「读不到图」。
   * 抬高上限只是把墙往后挪，所以改成从源头就不送那么大。
   */
  describe("给模型读的降采样版本", () => {
    it("图片带上 forModelReading，让存储适配器出降采样版", async () => {
      const current = deps();
      await resolveAgentAsset({ asset_id: "123" }, { userId: "7", projectId: "9" }, current);
      expect(current.sign).toHaveBeenCalledWith("uploads/7/image/immutable.png", {
        forModelReading: true,
      });
    });

    it("视频不降采样——图片处理参数对它不适用，且它走的是另一条理解链路", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          type: "video",
          mime: "video/mp4",
          storage_key: "uploads/7/video/clip.mp4",
          duration_seconds: 12,
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledWith("uploads/7/video/clip.mp4", {
        forModelReading: false,
      });
      // 视频的 mime 原样交出，不能被图片那条转码规则顺手改掉。
      expect(outcome).toMatchObject({ kind: "ok", value: { mime_type: "video/mp4" } });
    });

    // TOS 对 SVG 做 x-tos-process 会挂死——2026-09-05 测试站实测 25 秒零字节返回。
    // 绕开处理之后它原样吐字节，Agent 的嗅探认得出 <?xml，媒体白名单据此给不可重试的
    // asset_format_unsupported，而不是让用户干等一轮再收一句「请重试」。
    it("SVG 绕开图片处理——TOS 处理它会挂死", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          mime: "image/svg+xml",
          storage_key: "uploads/7/image/logo.bin",
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledWith("uploads/7/image/logo.bin", {
        forModelReading: false,
      });
      // mime 也要如实交出 svg，不能顺手报成 image/jpeg——那份 URL 吐的确实是 SVG。
      expect(outcome).toMatchObject({ kind: "ok", value: { mime_type: "image/svg+xml" } });
    });
  });

  /**
   * IKE53N：探测读原始字节。
   *
   * 降采样是给模型的。探测要回答的是「这份文件到底是什么」，而那个答案只能从用户的字节里读
   * ——读转码结果读到的是 TOS 的答案。文件没坏时它恒等于 jpeg（于是 Agent 的格式白名单对图片
   * 恒真），文件坏了时 TOS 直接回 400，一个字节也拿不到（测试站 2026-09-08 实测
   * `This image format is not supported`），探测只能报「取字节失败、可以重试」，模型照着这句
   * 话再读一遍，再失败一次。
   */
  describe("探测读原始字节", () => {
    it("图片签两次：一条带处理参数给模型，一条不带给探测", async () => {
      const current = deps();
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledTimes(2);
      expect(current.sign).toHaveBeenNthCalledWith(
        1,
        "uploads/7/image/immutable.png",
        { forModelReading: true },
      );
      expect(current.sign).toHaveBeenNthCalledWith(
        2,
        "uploads/7/image/immutable.png",
        { forModelReading: false },
      );
      const value = (outcome as { value: { read_url: string; probe_url: string } })
        .value;
      expect(value.read_url).toContain("x-tos-process");
      expect(value.probe_url).not.toContain("x-tos-process");
    });

    it("视频两条地址相同——它本来就不过图片处理，不必多签一次", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          type: "video",
          mime: "video/mp4",
          storage_key: "uploads/7/video/clip.mp4",
          duration_seconds: 12,
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledTimes(1);
      const value = (outcome as { value: { read_url: string; probe_url: string } })
        .value;
      expect(value.probe_url).toBe(value.read_url);
    });

    it("SVG 两条地址相同——它已经绕开了图片处理", async () => {
      const current = deps({
        findAccessible: vi.fn().mockResolvedValue({
          ...asset,
          mime: "image/svg+xml",
          storage_key: "uploads/7/image/logo.bin",
        }),
      });
      const outcome = await resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      );

      expect(current.sign).toHaveBeenCalledTimes(1);
      const value = (outcome as { value: { read_url: string; probe_url: string } })
        .value;
      expect(value.probe_url).toBe(value.read_url);
    });
  });

  it("rejects a request body that still carries the retired asset_version", () => {
    // 内容版本已整体撤除（IKASSI），两侧同轮完成：Agent 不再发送，这里也不再接受。schema 保持
    // `.strict()`，多余字段意味着调用方与契约不一致，此时在入口报错比静默忽略更早暴露问题。
    expect(
      agentAssetResolveRequestSchema.safeParse({
        asset_id: "123",
        asset_version: "av1_whatever",
      }).success,
    ).toBe(false);
    expect(agentAssetResolveRequestSchema.safeParse({ asset_id: "123" }).success).toBe(true);
  });

  it("resolves an Asset whose mutable metadata was backfilled after the Grant", async () => {
    // 这一条正是撤除内容版本校验的理由（IKASSI）。此前 duration_seconds 参与指纹派生，而上传
    // 时它是可选写入的：一次补时长的后台任务就会让指纹整体改变，此后所有历史 Grant 一律
    // 指纹失配，用户看到的是「资源不存在」——素材明明在。现在回填不再影响解析。
    const backfilled = { ...asset, duration_seconds: 12 };
    const current = deps({
      findAccessible: vi.fn().mockResolvedValue(backfilled),
    });
    const outcome = await resolveAgentAsset(
      { asset_id: "123" },
      { userId: "7", projectId: "9" },
      current,
    );

    expect(outcome).toMatchObject({
      kind: "ok",
      value: { asset_id: "123", duration_seconds: 12 },
    });
  });

  it("rejects missing trusted metadata without signing", async () => {
    const incomplete = { ...asset, size: null };
    const current = deps({
      findAccessible: vi.fn().mockResolvedValue(incomplete),
    });
    const outcome = await resolveAgentAsset(
      { asset_id: "123" },
      { userId: "7", projectId: "9" },
      current,
    );
    expect(outcome).toEqual({
      kind: "rejected",
      reason: "asset_metadata_unavailable",
    });
    expect(current.sign).not.toHaveBeenCalled();
  });

  it("rejects an Asset the owner tuple cannot reach, without signing", async () => {
    // 归属校验是撤除版本校验之后仅存的那道门，必须有测试锁住它没被一并削弱。
    const current = deps({ findAccessible: vi.fn().mockResolvedValue(null) });
    await expect(
      resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "asset_inaccessible" });
    expect(current.sign).not.toHaveBeenCalled();
  });

  it("does not expose signer failures", async () => {
    const current = deps({
      sign: vi.fn().mockRejectedValue(new Error("secret upstream detail")),
    });
    await expect(
      resolveAgentAsset(
        { asset_id: "123" },
        { userId: "7", projectId: "9" },
        current,
      ),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "storage_access_unavailable",
    });
  });
});
