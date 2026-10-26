import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIO_VIDEO_MUX_TAG } from "../shared/generation/queue.constants.js";
import { ERROR_AUDIO_VIDEO_MUX_FAILED, GENERATION_ERROR_NUMERIC_CODES } from "./error-codes.js";
import {
  AUDIO_VIDEO_MUX_CLIENT_TOKEN_PREFIX,
  AUDIO_VIDEO_MUX_JOB_TYPE,
  AUDIO_VIDEO_MUX_MODEL,
  AUDIO_VIDEO_MUX_POLL_PATH_PREFIX,
  AUDIO_VIDEO_MUX_RESULT_NAME_SUFFIX,
  AUDIO_VIDEO_MUX_SOURCE,
  AUDIO_VIDEO_MUX_SUBMIT_PATH,
  AUDIO_VIDEO_MUX_SYNC_MODES,
  audioVideoMuxClientToken,
  audioVideoMuxCreateSchema,
} from "./audio-video-mux.js";

const javaContract = readFileSync(new URL("../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/AudioVideoMuxContract.java", import.meta.url), "utf8");
const javaRoute = readFileSync(new URL("../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java", import.meta.url), "utf8");
const javaClient = readFileSync(new URL("../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/infrastructure/gateway/NewApiMediaKitMuxAudioVideoClient.java", import.meta.url), "utf8");
const javaFinalizer = readFileSync(new URL("../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/application/service/JobFinalizer.java", import.meta.url), "utf8");

describe("audio_video_mux 跨进程契约（IKIHPJ，迁移契约 §21）", () => {
  it("keeps task type, queue tag, routes and gateway endpoints aligned with Java", () => {
    expect(AUDIO_VIDEO_MUX_JOB_TYPE).toBe(AUDIO_VIDEO_MUX_TAG);
    expect(javaRoute).toContain('AUDIO_VIDEO_MUX("generation-task", "audio_video_mux")');
    expect(javaContract).toContain(`SOURCE = "${AUDIO_VIDEO_MUX_SOURCE}";`);
    expect(javaContract).toContain(`= "${AUDIO_VIDEO_MUX_SUBMIT_PATH}";`);
    expect(javaContract).toContain(`= "${AUDIO_VIDEO_MUX_POLL_PATH_PREFIX}";`);
    expect(javaClient).toContain(`= "${AUDIO_VIDEO_MUX_MODEL}";`);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_AUDIO_VIDEO_MUX_FAILED]).toBe(1053);
  });

  it("pins frozen input keys and sync tiers identically on both runtimes", () => {
    expect(javaContract).toContain('INPUT_KEY_AUDIO = "audio";');
    expect(javaContract).toContain('INPUT_KEY_VIDEO = "video";');
    expect(javaContract).toContain('INPUT_KEY_IS_AUDIO_RESERVE = "is_audio_reserve";');
    expect(javaContract).toContain('INPUT_KEY_SYNC = "sync";');
    expect(javaContract).toContain('INPUT_KEY_SUBMIT_ATTEMPT = "submit_attempt";');
    expect(javaContract).toContain('INPUT_FIELD_ASSET_ID = "assetId";');
    expect(javaContract).toContain('INPUT_FIELD_NODE_ID = "nodeId";');
    expect(javaContract).toContain('INPUT_FIELD_URL = "url";');
    expect(javaContract).toContain('List.of("none", "video", "audio")');
    expect([...AUDIO_VIDEO_MUX_SYNC_MODES]).toEqual(["none", "video", "audio"]);
  });

  it("pins the vendor outbound keys without mixing them into the frozen input naming", () => {
    for (const key of ["video_url", "audio_url", "is_audio_reserve", "is_video_audio_sync", "sync_mode", "sync_method", "client_token"]) {
      expect(javaClient, `出站键 ${key} 应冻结在网关客户端`).toContain(`"${key}"`);
    }
    for (const key of ["video_url", "audio_url", "is_video_audio_sync", "sync_mode", "sync_method"]) {
      expect(javaContract, `出站键 ${key} 不应混入冻结快照常量`).not.toContain(`INPUT_KEY_${key.toUpperCase()}`);
    }
    expect(javaClient).toContain('"trim"');
  });

  it("keeps the transfer capacity constant aligned with the 10 GiB audio-side precedent", () => {
    expect(javaContract).toContain("MAX_RESULT_BYTES = 10L << 30");
  });

  it("pins the result-name suffix so the TS constant and the Java literal cannot drift apart", () => {
    expect(AUDIO_VIDEO_MUX_RESULT_NAME_SUFFIX).toBe("(音视频合成).mp4");
    expect(javaFinalizer).toContain(`+ "${AUDIO_VIDEO_MUX_RESULT_NAME_SUFFIX}";`);
    expect(javaFinalizer).toContain('if (base.isEmpty()) base = "视频";');
  });

  it("derives a printable ASCII client token deterministically from job id and submit attempt", () => {
    expect(AUDIO_VIDEO_MUX_CLIENT_TOKEN_PREFIX).toBe("bwmux-");
    expect(audioVideoMuxClientToken("70", 1)).toBe("bwmux-70-1");
    expect(audioVideoMuxClientToken("70", 1)).toBe(audioVideoMuxClientToken("70", 1));
    expect(audioVideoMuxClientToken("70", 2)).not.toBe(audioVideoMuxClientToken("70", 1));
    const worstCase = audioVideoMuxClientToken("9".repeat(20), 9_999);
    expect(worstCase.length).toBeLessThanOrEqual(64);
    expect(worstCase).toMatch(/^[!-~]+$/);
    expect(javaContract).toContain(`CLIENT_TOKEN_PREFIX = "${AUDIO_VIDEO_MUX_CLIENT_TOKEN_PREFIX}";`);
    expect(javaContract).toContain("static String clientToken(");
  });

  it("freezes camel-case identities with a fixed audio source and an optional video node", () => {
    const valid = { audio: { assetId: "11", nodeId: "source-node" }, video: { assetId: "12" } };
    expect(audioVideoMuxCreateSchema.parse(valid)).toMatchObject({
      audio: { assetId: "11", nodeId: "source-node" },
      video: { assetId: "12" },
      is_audio_reserve: true,
      sync: "none",
    });
    expect(audioVideoMuxCreateSchema.parse({
      audio: { assetId: "11", nodeId: "source-node" },
      video: { assetId: "12", nodeId: "video-node" },
      is_audio_reserve: false,
      sync: "audio",
    })).toMatchObject({ is_audio_reserve: false, sync: "audio", video: { nodeId: "video-node" } });

    expect(audioVideoMuxCreateSchema.safeParse({ ...valid, audio: { assetId: "11" } }).success).toBe(false);
    expect(audioVideoMuxCreateSchema.safeParse({ video: { assetId: "12" } }).success).toBe(false);
    expect(audioVideoMuxCreateSchema.safeParse({ audio: { asset_id: "11", node_id: "source-node" }, video: { asset_id: "12" } }).success).toBe(false);
    expect(audioVideoMuxCreateSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(audioVideoMuxCreateSchema.safeParse({ ...valid, audio: { assetId: "0", nodeId: "source-node" } }).success).toBe(false);
    expect(audioVideoMuxCreateSchema.safeParse({ ...valid, sync: "speed" }).success).toBe(false);
  });
});
