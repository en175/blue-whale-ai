import { afterEach, describe, expect, it, vi } from "vitest";

import { createTosStorage, parseMediaInfo } from "./tos-storage.js";

const AUDIO = {
  streams: [
    {
      index: 0,
      codec_name: "mp3",
      codec_type: "audio",
      duration: "4.848000",
      disposition: { attached_pic: 0 },
    },
  ],
  format: {
    format_name: "mp3",
    duration: "4.848000",
    size: "77997",
  },
};

const VIDEO = {
  streams: [
    {
      index: 0,
      codec_name: "h264",
      codec_type: "video",
      width: 640,
      height: 360,
      avg_frame_rate: "25/1",
      duration: "32.160000",
      disposition: { attached_pic: 0 },
    },
    {
      index: 1,
      codec_name: "aac",
      codec_type: "audio",
      duration: "32.182993",
      disposition: { attached_pic: 0 },
    },
  ],
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: "32.160000",
    size: "1234567",
  },
};

describe("parseMediaInfo（TOS video/info 响应）", () => {
  it("纯音频：返回时长、大小、编码，宽高为空", () => {
    expect(parseMediaInfo(AUDIO)).toEqual({
      sizeBytes: 77997,
      durationMs: 4848,
      width: null,
      height: null,
      codec: "mp3",
      container: "mp3",
      fps: null,
    });
  });

  it("视频：返回时长、宽高、编码、帧率", () => {
    expect(parseMediaInfo(VIDEO)).toMatchObject({
      sizeBytes: 1234567,
      durationMs: 32160,
      width: 640,
      height: 360,
      codec: "h264",
      fps: 25,
    });
  });

  it("封面图（attached_pic）不当成视频流", () => {
    const withCover = {
      streams: [
        {
          codec_name: "mjpeg",
          codec_type: "video",
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        { codec_name: "aac", codec_type: "audio", duration: "30.0" },
      ],
      format: { format_name: "mov,mp4,m4a", duration: "30.0", size: "1000" },
    };

    expect(parseMediaInfo(withCover)).toMatchObject({
      width: null,
      height: null,
      codec: "aac",
      durationMs: 30000,
    });
  });

  it("format 没有时长时回落到 stream 时长", () => {
    const withoutFormatDuration = {
      streams: [
        {
          codec_name: "h264",
          codec_type: "video",
          width: 1280,
          height: 720,
          duration: "5.5",
          disposition: { attached_pic: 0 },
        },
      ],
      format: { format_name: "mov,mp4", size: "42" },
    };

    expect(parseMediaInfo(withoutFormatDuration)).toMatchObject({
      durationMs: 5500,
      width: 1280,
      height: 720,
    });
  });

  it("format duration 为 0 或负数：回落到 stream 时长", () => {
    const zero = {
      ...VIDEO,
      format: { ...VIDEO.format, duration: "0.000000" },
    };
    const negative = {
      ...VIDEO,
      format: { ...VIDEO.format, duration: "-2.0" },
    };

    expect(parseMediaInfo(zero).durationMs).toBe(32160);
    expect(parseMediaInfo(negative).durationMs).toBe(32160);
  });

  it("封面流不参与 stream 时长回退", () => {
    const raw = {
      streams: [
        {
          codec_name: "mjpeg",
          codec_type: "video",
          duration: "99.0",
          disposition: { attached_pic: 1 },
        },
        {
          codec_name: "aac",
          codec_type: "audio",
          duration: "30.0",
          disposition: { attached_pic: 0 },
        },
      ],
      format: { format_name: "mov,mp4", size: "1000" },
    };

    expect(parseMediaInfo(raw).durationMs).toBe(30000);
  });

  it("宽高/大小为 0 或负数：返回 null", () => {
    const raw = {
      streams: [
        {
          codec_name: "h264",
          codec_type: "video",
          width: 0,
          height: -1,
          duration: "1.0",
          disposition: { attached_pic: 0 },
        },
      ],
      format: { format_name: "mov,mp4", size: "0" },
    };

    expect(parseMediaInfo(raw)).toMatchObject({
      width: null,
      height: null,
      sizeBytes: null,
      durationMs: 1000,
    });
  });

  it("没有任何可用字段：拒绝", () => {
    expect(() => parseMediaInfo({})).toThrow("TOS media info 缺少可用字段");
  });
});

describe("createTosStorage.probe", () => {
  const config = {
    accessKeyId: "ak",
    secretAccessKey: "sk",
    endpoint: "tos-cn-beijing.volces.com",
    bucket: "bucket",
    region: "cn-beijing",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("签名 URL 带 x-tos-process=video/info，并返回解析结果", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(AUDIO), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const storage = createTosStorage(config);
    const info = await storage.probe("uploads/a.mp3");

    expect(info.durationMs).toBe(4848);
    const [url, init] = fetchMock.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(String(url)).toContain("x-tos-process=video");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("非 2xx：拒绝并带 storageKey", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));

    await expect(createTosStorage(config).probe("uploads/a.mp3")).rejects.toThrow(
      "TOS media info failed for uploads/a.mp3: HTTP 500",
    );
  });

  it("非 JSON：拒绝", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));

    await expect(createTosStorage(config).probe("uploads/a.mp3")).rejects.toThrow(
      "TOS media info invalid JSON",
    );
  });

  it("响应过大：拒绝", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(300 * 1024) },
        }),
      ),
    );

    await expect(createTosStorage(config).probe("uploads/a.mp3")).rejects.toThrow(
      "TOS media info response too large",
    );
  });
});
