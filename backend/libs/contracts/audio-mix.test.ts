import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIO_MIX_TAG } from "../shared/generation/queue.constants.js";
import { ERROR_AUDIO_MIX_FAILED, GENERATION_ERROR_NUMERIC_CODES } from "./error-codes.js";
import {
  AUDIO_MIX_DEFAULT_OUTPUT_FORMAT,
  AUDIO_MIX_JOB_TYPE,
  AUDIO_MIX_OUTPUT_FORMATS,
  AUDIO_MIX_POLL_PATH_PREFIX,
  AUDIO_MIX_SUBMIT_PATH,
  audioMixCreateSchema,
} from "./audio-mix.js";

const javaContract = readFileSync(new URL("../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/AudioMixContract.java", import.meta.url), "utf8");
const javaRoute = readFileSync(new URL("../../../worker-java/src/main/java/com/bluewhale/worker/domain/contract/GenerationMqRouteEnum.java", import.meta.url), "utf8");

describe("audio_mix 跨进程契约", () => {
  it("keeps task type, queue tag, routes and default format aligned with Java", () => {
    expect(AUDIO_MIX_JOB_TYPE).toBe(AUDIO_MIX_TAG);
    expect(javaRoute).toContain('AUDIO_MIX("generation-task", "audio_mix")');
    expect(javaContract).toContain(`= "${AUDIO_MIX_DEFAULT_OUTPUT_FORMAT}";`);
    expect(javaContract).toContain(`= "${AUDIO_MIX_SUBMIT_PATH}";`);
    expect(javaContract).toContain(`= "${AUDIO_MIX_POLL_PATH_PREFIX}";`);
    expect(javaContract).toContain('List.of("mp3", "m4a", "ogg", "flac", "wav")');
    expect([...AUDIO_MIX_OUTPUT_FORMATS]).toEqual(["mp3", "m4a", "ogg", "flac", "wav"]);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_AUDIO_MIX_FAILED]).toBe(1051);
  });

  it("requires ordered fixed source and 2–100 unique asset identities", () => {
    const first = { asset_id: "11", node_id: "source" };
    const valid = { source_node_id: "source", inputs: [first, { asset_id: "12" }] };
    expect(audioMixCreateSchema.parse(valid).output_format).toBe("mp3");
    expect(audioMixCreateSchema.safeParse({ ...valid, inputs: [first] }).success).toBe(false);
    expect(audioMixCreateSchema.safeParse({ ...valid, inputs: [first, first] }).success).toBe(false);
    expect(audioMixCreateSchema.safeParse({ ...valid, source_node_id: "other" }).success).toBe(false);
    expect(audioMixCreateSchema.safeParse({ ...valid, inputs: Array.from({ length: 101 }, (_, i) => ({ asset_id: String(i + 1), node_id: i === 0 ? "source" : undefined })) }).success).toBe(false);
  });
});
