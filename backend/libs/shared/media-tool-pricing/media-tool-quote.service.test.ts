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

  it("计价服务异常时退化为不报价而不是冒泡", async () => {
    const service = makeService();
    quote.mockRejectedValue(new Error("billing down"));
    expect(await service.quote("audio_speed", "9", { source_asset_id: "1" })).toEqual({
      credits: null,
      quote_revision: null,
    });
  });
});
