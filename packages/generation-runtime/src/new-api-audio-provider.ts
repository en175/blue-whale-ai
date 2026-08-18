import {
  AudioProviderError,
  type AudioProvider,
  type GenerateAudioInput,
  type GeneratedAudio,
} from "./audio-provider.js";

export interface NewApiAudioProviderOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/** 官方 seed-audio-1.0 JSON 响应(new-api 全透传,解析官方字段) */
interface OfficialAudioResponse {
  audio?: string;
  url?: string;
  duration?: number;
}

export function createNewApiAudioProvider(
  options: NewApiAudioProviderOptions,
): AudioProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return {
    async generate(input: GenerateAudioInput): Promise<GeneratedAudio> {
      const response = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.token}`,
        },
        body: JSON.stringify({
          model: input.model,
          text_prompt: input.prompt,
          audio_config: {
            format: "mp3",
            sample_rate: 48000,
            pitch_rate: 0,
            speech_rate: 0,
            loudness_rate: 0,
          },
          watermark: {},
        }),
      });
      if (!response.ok) {
        throw new AudioProviderError(
          "provider_failed",
          `new-api 音频生成失败: ${response.status}`,
        );
      }
      let payload: OfficialAudioResponse;
      try {
        payload = (await response.json()) as OfficialAudioResponse;
      } catch {
        throw new AudioProviderError("no_result", "生成服务未返回有效 JSON");
      }
      const url = typeof payload.url === "string" ? payload.url : null;
      const data =
        typeof payload.audio === "string" && payload.audio.length > 0
          ? new Uint8Array(Buffer.from(payload.audio, "base64"))
          : undefined;
      if (data === undefined && url === null) {
        throw new AudioProviderError("no_result", "生成服务未返回音频结果");
      }
      const duration =
        typeof payload.duration === "number" && Number.isFinite(payload.duration)
          ? payload.duration
          : undefined;
      const requestId =
        response.headers.get("x-oneapi-request-id") ?? undefined;
      return {
        url,
        mime: "audio/mpeg",
        ...(data !== undefined ? { data } : {}),
        ...(duration !== undefined ? { duration } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      };
    },
  };
}
