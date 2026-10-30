import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetService } from "@lib/shared/assets/assets.service.js";
import type { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import type { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import type { MediaToolBillingService } from "./media-tool-billing.service.js";
import { MediaToolQuoteService } from "./media-tool-quote.service.js";

type AssetRow = {
  type: string;
  project_id: bigint;
  storage_key: string | null;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  source: string | null;
};

function assetRow(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    type: "audio",
    project_id: 0n,
    storage_key: "media/a.mp3",
    url: "https://tos.example.com/media/a.mp3",
    mime: null,
    size: null,
    width: null,
    height: null,
    duration_ms: 60_000,
    source: null,
    ...overrides,
  };
}

const ASSETS = new Map<string, AssetRow>([
  ["1", assetRow({ duration_ms: 60_000 })],
  ["2", assetRow({ duration_ms: 30_000 })],
  ["3", assetRow({ duration_ms: 62_500 })],
  ["4", assetRow({ type: "video", duration_ms: 10_200, width: 1920, height: 1080 })],
  ["5", assetRow({ duration_ms: null })],
  ["6", assetRow({ type: "video", duration_ms: 4_900, width: 854, height: 480 })],
  ["7", assetRow({ type: "video", duration_ms: 61_046, width: 1920, height: 1080 })],
]);

const quote = vi.fn();
const findOwnedSource = vi.fn();

function makeService() {
  return new MediaToolQuoteService(
    { client: {} } as PrismaService,
    { findOwnedSource } as unknown as AssetService,
    {} as AssetStorageService,
    { quote } as unknown as MediaToolBillingService,
  );
}

beforeEach(() => {
  quote.mockReset();
  quote.mockResolvedValue({ credits: 7, quote_revision: "rev-1" });
  findOwnedSource.mockReset();
  findOwnedSource.mockImplementation(async (id: string) => ASSETS.get(id) ?? null);
});

describe("MediaToolQuoteService：服务端权威推导报价入参", () => {
  it("音频截取按源时长与起止点推导，不再采信客户端的 duration", async () => {
    const service = makeService();
    await service.quote("audio_trim", "9", {
      source_asset_id: "1",
      start_time: 1.5,
      end_time: 10.4,
      duration: 999,
    });
    expect(quote).toHaveBeenCalledWith(
      "audio_trim",
      "9",
      expect.objectContaining({ duration: 9 }),
    );
  });

  it("音频调速按源时长与倍速推导", async () => {
    const service = makeService();
    await service.quote("audio_speed", "9", { source_asset_id: "1", speed: 2 });
    expect(quote).toHaveBeenCalledWith(
      "audio_speed",
      "9",
      expect.objectContaining({ duration: 30 }),
    );
  });

  it("音频混合取最长输入", async () => {
    const service = makeService();
    await service.quote("audio_mix", "9", {
      inputs: [{ asset_id: "2" }, { asset_id: "3" }],
    });
    expect(quote).toHaveBeenCalledWith(
      "audio_mix",
      "9",
      expect.objectContaining({ duration: 63 }),
    );
  });

  it("音视频合流用毫秒向上取整与资产分辨率，与扣费同口径", async () => {
    const service = makeService();
    await service.quote("audio_video_mux", "9", {
      audio: { assetId: "2" },
      video: { assetId: "4" },
      sync: "video",
    });
    expect(quote).toHaveBeenCalledWith(
      "audio_video_mux",
      "9",
      expect.objectContaining({ duration: 11, resolution: "1080p" }),
    );
  });

  it("单来源视频工具按资产时长推导", async () => {
    const service = makeService();
    await service.quote("video_enhance", "9", {
      source_asset_id: "4",
      resolution: "2k",
    });
    expect(quote).toHaveBeenCalledWith(
      "video_enhance",
      "9",
      expect.objectContaining({ duration: 10, resolution: "2k" }),
    );
  });

  it("图片常量计价工具直接采用面板参数", async () => {
    const service = makeService();
    await service.quote("image_enhance", "9", { multiple: 4 });
    expect(findOwnedSource).not.toHaveBeenCalled();
    expect(quote).toHaveBeenCalledWith("image_enhance", "9", { multiple: 4 });
  });
});

describe("MediaToolQuoteService：不报价与降级", () => {
  it("素材不属于当前用户或不存在时不报价", async () => {
    const service = makeService();
    findOwnedSource.mockResolvedValue(null);
    expect(await service.quote("audio_trim", "9", { source_asset_id: "1" })).toEqual({
      credits: null,
      quote_revision: null,
    });
    expect(quote).not.toHaveBeenCalled();
  });

  it("资产缺少时长且无法探测时不报价", async () => {
    const service = makeService();
    expect(await service.quote("video_matting", "9", { source_asset_id: "5" })).toEqual({
      credits: null,
      quote_revision: null,
    });
  });

  it("非法素材 ID 或参数类型不报价", async () => {
    const service = makeService();
    expect(await service.quote("audio_trim", "9", { source_asset_id: "abc" })).toEqual({
      credits: null,
      quote_revision: null,
    });
    expect(
      await service.quote("audio_trim", "9", { source_asset_id: "1", start_time: "2" }),
    ).toEqual({ credits: null, quote_revision: null });
    expect(findOwnedSource).not.toHaveBeenCalled();
  });

  it("未知工具类型不采信客户端入参", async () => {
    const service = makeService();
    expect(
      await service.quote("video_audio_split", "9", { duration: 60 }),
    ).toEqual({ credits: null, quote_revision: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("混合输入超上限、重复或非音频素材不报价", async () => {
    const service = makeService();
    const many = Array.from({ length: 101 }, (_, index) => ({
      asset_id: String(index + 1),
    }));
    expect(await service.quote("audio_mix", "9", { inputs: many })).toEqual({
      credits: null,
      quote_revision: null,
    });
    expect(findOwnedSource).not.toHaveBeenCalled();

    expect(
      await service.quote("audio_mix", "9", {
        inputs: [{ asset_id: "1" }, { asset_id: "1" }],
      }),
    ).toEqual({ credits: null, quote_revision: null });

    expect(
      await service.quote("audio_mix", "9", {
        inputs: [{ asset_id: "1" }, { asset_id: "4" }],
      }),
    ).toEqual({ credits: null, quote_revision: null });
  });

  it("截取与调速入参不符合提交约束时不报价", async () => {
    const service = makeService();
    expect(
      await service.quote("audio_trim", "9", {
        source_asset_id: "1",
        start_time: -1,
        end_time: 10,
      }),
    ).toEqual({ credits: null, quote_revision: null });
    expect(
      await service.quote("audio_trim", "9", {
        source_asset_id: "1",
        start_time: 1.004,
        end_time: 2.001,
      }),
    ).toMatchObject({ credits: 7 });
    expect(quote).toHaveBeenLastCalledWith(
      "audio_trim",
      "9",
      expect.objectContaining({ duration: 1 }),
    );
    expect(
      await service.quote("audio_trim", "9", {
        source_asset_id: "1",
        start_time: 10,
        end_time: 10,
      }),
    ).toEqual({ credits: null, quote_revision: null });
    expect(
      await service.quote("audio_speed", "9", { source_asset_id: "1", speed: 100 }),
    ).toEqual({ credits: null, quote_revision: null });
    expect(
      await service.quote("audio_speed", "9", { source_asset_id: "1", speed: 1.234 }),
    ).toEqual({ credits: null, quote_revision: null });
  });

  it("URL-only 老素材可借存储键探测时长后报价", async () => {
    vi.stubEnv("VOLC_ACCESS_KEY_ID", "test");
    vi.stubEnv("VOLC_SECRET_ACCESS_KEY", "test");
    vi.stubEnv("VOLC_TOS_ENDPOINT", "tos.example");
    vi.stubEnv("VOLC_TOS_BUCKET", "our-bucket");
    vi.stubEnv("VOLC_TOS_REGION", "test");
    findOwnedSource.mockResolvedValue(
      assetRow({
        storage_key: null,
        url: "https://our-bucket.tos.example/media/a.mp3",
        duration_ms: null,
      }),
    );
    const probe = vi.fn().mockResolvedValue({
      durationMs: 30_000,
      width: null,
      height: null,
    });
    const service = new MediaToolQuoteService(
      { client: {} } as PrismaService,
      { findOwnedSource } as unknown as AssetService,
      { probe } as unknown as AssetStorageService,
      { quote } as unknown as MediaToolBillingService,
    );
    await service.quote("audio_trim", "9", { source_asset_id: "1" });
    expect(probe).toHaveBeenCalledWith("media/a.mp3");
    expect(quote).toHaveBeenCalledWith(
      "audio_trim",
      "9",
      expect.objectContaining({ duration: 30 }),
    );
    vi.unstubAllEnvs();
  });

  it("计价服务异常时退化为不报价而不是冒泡", async () => {
    const service = makeService();
    quote.mockRejectedValue(new Error("billing down"));
    expect(await service.quote("audio_speed", "9", { source_asset_id: "1" })).toEqual({
      credits: null,
      quote_revision: null,
    });
  });
});

describe("MediaToolQuoteService：5 秒档工具时长向下取整（IKRQYW）", () => {
  it.each([
    "video_subtitle_erase",
    "video_frame_interpolation",
    "video_matting",
  ])("%s 的 4.9 秒素材按 4 秒进档，不越到 10 秒档", async (toolType) => {
    const service = makeService();
    await service.quote(toolType, "9", { source_asset_id: "6" });
    expect(quote).toHaveBeenCalledWith(
      toolType,
      "9",
      expect.objectContaining({ duration: 4 }),
    );
  });

  it("分钟档工具保持四舍五入：61.046 秒按 61 秒", async () => {
    const service = makeService();
    await service.quote("video_scene_split", "9", { source_asset_id: "7" });
    expect(quote).toHaveBeenCalledWith(
      "video_scene_split",
      "9",
      expect.objectContaining({ duration: 61 }),
    );
  });
});
