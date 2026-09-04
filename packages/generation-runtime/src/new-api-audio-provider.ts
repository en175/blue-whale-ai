import {
  ERROR_CONTENT_REJECTED,
  ERROR_NO_RESULT,
  ERROR_PROVIDER_FAILED,
  ERROR_QUOTA_EXHAUSTED,
  isContentPolicySignal,
  isQuotaSignal,
} from "@blue-whale/contracts";
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
        // IKBQEE：余额不足识别——不只看 402，也认 body 关键词（镜像 image/video provider）。
        // 音频 new-api 预扣费失败同样可能是 HTTP200+body 报错，落 quota_exhausted 保证 message 准确。
        // IKDAJN：版权/敏感（copyright/sensitive）优先于 quota 判定，归 content_rejected。
        // 注意：上游原文只用于分类判定，不写入 error.message——对外中文固定文案，原文由
        // failClaimed 落 error.details.raw（ADR-0078「message 不泄漏 provider 原文」）。
        const msg = await response.text().catch(() => "");
        const code = isContentPolicySignal(msg)
          ? ERROR_CONTENT_REJECTED
          : isQuotaSignal(msg, response.status)
            ? ERROR_QUOTA_EXHAUSTED
            : ERROR_PROVIDER_FAILED;
        throw new AudioProviderError(
          code,
          `new-api 音频生成失败: ${response.status}`,
        );
      }
      let payload: OfficialAudioResponse;
      try {
        const rawText = await response.text();
        // IKBQEE：HTTP200+body 预扣费失败（new-api 欠费业务态）→ quota_exhausted，保证 message 准确。
        // IKDAJN：HTTP200+body 版权/敏感（如 doubao-seedream 版权限制）→ content_rejected。
        if (isContentPolicySignal(rawText)) {
          throw new AudioProviderError(
            ERROR_CONTENT_REJECTED,
            "生成内容涉及版权或敏感信息",
          );
        }
        if (isQuotaSignal(rawText)) {
          throw new AudioProviderError(
            ERROR_QUOTA_EXHAUSTED,
            "new-api 音频生成余额不足",
          );
        }
        payload = JSON.parse(rawText) as OfficialAudioResponse;
      } catch (error) {
        if (error instanceof AudioProviderError) throw error;
        throw new AudioProviderError(ERROR_NO_RESULT, "生成服务未返回有效 JSON");
      }
      const url = typeof payload.url === "string" ? payload.url : null;
      const data =
        typeof payload.audio === "string" && payload.audio.length > 0
          ? new Uint8Array(Buffer.from(payload.audio, "base64"))
          : undefined;
      if (data === undefined && url === null) {
        throw new AudioProviderError(ERROR_NO_RESULT, "生成服务未返回音频结果");
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
