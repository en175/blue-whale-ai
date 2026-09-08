import {
  ERROR_CONTENT_REJECTED,
  ERROR_NO_RESULT,
  ERROR_PROVIDER_FAILED,
  ERROR_PROVIDER_TIMEOUT,
  ERROR_QUOTA_EXHAUSTED,
  isContentPolicySignal,
  isQuotaSignal,
} from "@blue-whale/contracts";
import { createNewApiRawRequest, NewApiTimeoutError } from "@blue-whale/core";
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
  /** 测试注入用 env；缺省 process.env（对齐 ark-image-provider ProviderOptions 模式）。 */
  env?: Readonly<Record<string, string | undefined>>;
  /** 音频生成单次调用超时（毫秒）。默认 30s——成功需 14–20s，30s 给足余量。
   *  参考图片 NEW_API_IMAGE_TIMEOUT_MS 模式（IKDQ5F）。 */
  timeoutMs?: number;
}

/** 官方 seed-audio-1.0 JSON 响应(new-api 全透传,解析官方字段) */
interface OfficialAudioResponse {
  audio?: string;
  url?: string;
  duration?: number;
}

/** 成功态错误信封（IKDQ5F）：HTTP200 + body 是错误信封时才做信号判定，不对整段 base64 判定。 */
interface NewApiEnvelopeLike {
  error?: { message?: unknown };
}

/** 音频超时默认 30s（成功 14–20s；超时归 ERROR_PROVIDER_TIMEOUT，不再被误判欠费）。 */
export const DEFAULT_AUDIO_TIMEOUT_MS = 30_000;

function loadAudioTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.NEW_API_AUDIO_TIMEOUT_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_AUDIO_TIMEOUT_MS;
}

export function createNewApiAudioProvider(
  options: NewApiAudioProviderOptions,
): AudioProvider {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const timeoutMs =
    options.timeoutMs ?? loadAudioTimeoutMs(options.env ?? process.env);
  // IKDQ5F：音频并入统一传输层（core new-api-transport）——超时、出站头
  // （X-Trace-Id / X-Client-System）、错误类与图片/视频 provider 同构，不再裸 fetch 单干。
  const rawRequest = createNewApiRawRequest({
    baseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    timeoutMs,
  });

  return {
    async generate(input: GenerateAudioInput): Promise<GeneratedAudio> {
      let response;
      try {
        // IKE4GC：透传 body 在 model/text_prompt/audio_config/watermark 基础上，携带时加 references
        //  （seed-audio 参考素材数组）。text_prompt 原样透传（@AudioN/@ImageN 由前端负责）。
        const payload: Record<string, unknown> = {
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
        };
        if (input.references && input.references.length > 0) {
          payload.references = input.references;
        }
        response = await rawRequest(
          "/v1/audio/speech",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          options.token,
        );
      } catch (error) {
        // IKDQ5F：超时（AbortController 主动中止）→ provider_timeout，不再误判欠费。
        if (error instanceof NewApiTimeoutError) {
          throw new AudioProviderError(
            ERROR_PROVIDER_TIMEOUT,
            "new-api 音频生成超时",
          );
        }
        throw new AudioProviderError(
          ERROR_PROVIDER_FAILED,
          error instanceof Error ? error.message : "new-api 音频生成失败",
        );
      }

      // IKBQEE/IKDQ5F：欠费/版权判定只在失败路径做——成功响应的 rawText 是音频 base64 二进制
      // （几万字节随机字母），对整段跑 isQuotaSignal 会随机命中英文子串（quota/balance…），
      // 一次完全成功的生成被误判 quota_exhausted 丢弃（job 1743 根因）。成功直接 JSON.parse 取
      // audio/url；仅 !ok（或解析出的错误信封含 error.message）才做信号判定。
      // IKDAJN：非 2xx 时版权/敏感（copyright/sensitive）优先于 quota，归 content_rejected。
      // 注意：上游原文只用于分类判定，不写入 error.message——对外中文固定文案，原文由
      // failClaimed 落 error.details.raw（ADR-0078「message 不泄漏 provider 原文」）。
      if (response.status < 200 || response.status >= 300) {
        const msg = response.text;
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
        const rawText = response.text;
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          // 成功态非 JSON：不判欠费/版权（避免对长文本/base64 误伤），落 no_result。
          throw new AudioProviderError(ERROR_NO_RESULT, "生成服务未返回有效 JSON");
        }
        const envelope = parsed as NewApiEnvelopeLike;
        // 成功态且解析为错误信封（含 error.message）→ 才做信号判定（不整段 base64 判定）。
        if (envelope && typeof envelope.error?.message === "string") {
          const errText = String(envelope.error.message);
          // IKDAJN：版权/敏感优先于 quota（如 doubao-seedream 版权限制）。
          if (isContentPolicySignal(errText)) {
            throw new AudioProviderError(
              ERROR_CONTENT_REJECTED,
              "生成内容涉及版权或敏感信息",
            );
          }
          if (isQuotaSignal(errText)) {
            throw new AudioProviderError(
              ERROR_QUOTA_EXHAUSTED,
              "new-api 音频生成余额不足",
            );
          }
          throw new AudioProviderError(
            ERROR_PROVIDER_FAILED,
            "new-api 音频生成业务失败",
          );
        }
        payload = parsed as OfficialAudioResponse;
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
      return {
        url,
        mime: "audio/mpeg",
        ...(data !== undefined ? { data } : {}),
        ...(duration !== undefined ? { duration } : {}),
        ...(response.requestId !== null ? { requestId: response.requestId } : {}),
      };
    },
  };
}
