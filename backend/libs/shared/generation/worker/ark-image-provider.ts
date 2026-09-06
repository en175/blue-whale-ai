import {
  ArkImageError,
  NewApiError,
  generateImages,
  loadArkImageConfig,
} from "@blue-whale/core";
import { createNewApiClient } from "@blue-whale/core";
import {
  ERROR_CONTENT_REJECTED,
  ERROR_PROVIDER_CONFIG,
  ERROR_PROVIDER_FAILED,
  ERROR_QUOTA_EXHAUSTED,
  ERROR_UNSUPPORTED_INPUT,
  isContentPolicySignal,
  isQuotaSignal,
} from "@blue-whale/contracts";

import {
  ImageProviderError,
  type GenerateImageInput,
  type GeneratedImage,
  type ImageProvider,
} from "./image-provider.js";

type ProviderOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  token?: string;
  fetchImpl?: typeof fetch;
};

/** Ark 图片 provider：用 core 的 ark-image-client。 */
export function createArkImageProvider(
  options: Pick<ProviderOptions, "env" | "fetchImpl"> = {},
): ImageProvider {
  const env = options.env ?? process.env;
  const config = loadArkImageConfig(env);
  if (!config) {
    throw new Error("VOLC_ARK_BASE_URL / VOLC_ARK_API_KEY 未配置");
  }
  return {
    async generate(input: GenerateImageInput): Promise<GeneratedImage[]> {
      if (input.sourceImage || input.sourceImages?.length) {
        throw new ImageProviderError(
          ERROR_UNSUPPORTED_INPUT,
          "Ark fallback 不支持图片编辑输入",
        );
      }
      try {
        const result = await generateImages(
          config,
          {
            model: input.model,
            prompt: input.prompt,
            ...(typeof input.size === "string" ? { size: input.size } : {}),
            n: input.n,
            ...(input.webSearch !== undefined ? { webSearch: input.webSearch } : {}),
            ...(input.sequential !== undefined ? { sequential: input.sequential } : {}),
          },
          options.fetchImpl,
        );
        // Ark url 模式不返回宽高；用能力表尺寸兜底（worker 传入）。
        return result.urls.map((url) => ({
          url,
          width: input.width ?? null,
          height: input.height ?? null,
        }));
      } catch (e) {
        if (e instanceof ArkImageError) {
          throw new ImageProviderError(e.code, e.message);
        }
        throw new ImageProviderError(
          ERROR_PROVIDER_FAILED,
          e instanceof Error ? e.message : "unknown",
        );
      }
    },
  };
}

function createNewApiImageProvider(options: ProviderOptions): ImageProvider {
  const baseUrl = options.env?.NEW_API_BASE_URL ?? process.env.NEW_API_BASE_URL;
  if (!baseUrl || !options.token) {
    return {
      async generate(): Promise<GeneratedImage[]> {
        throw new ImageProviderError(
          ERROR_PROVIDER_CONFIG,
          "NEW_API_BASE_URL 或用户 sk token 未配置",
        );
      },
    };
  }
  // 出图是一次性长调用（2k 单图实测 ~19s，多图/大图更久），远超 new-api 客户端默认 10s 超时——
  // 默认超时会在出图途中 abort，被误报成「new-api 不可达」(线上 job 416/421/422 即此)。
  // 视频 submit/poll 都是短调用，不受影响。这里给图片单独放宽，留出 120s 租约内的转存余量。
  const rawTimeout = Number(
    options.env?.NEW_API_IMAGE_TIMEOUT_MS ??
      process.env.NEW_API_IMAGE_TIMEOUT_MS,
  );
  const timeoutMs =
    Number.isInteger(rawTimeout) && rawTimeout > 0 ? rawTimeout : 90_000;
  const client = createNewApiClient({
    baseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    timeoutMs,
  });
  return {
    async generate(input) {
      try {
        const sourceImages =
          input.sourceImages ?? (input.sourceImage ? [input.sourceImage] : []);
        // IK7G9X：用 with-receipt 变体拿 request_id（消费流水精确关联键）。
        const receipt =
          sourceImages.length > 0
            ? await client.editImagesWithReceipt(options.token!, {
                model: input.model,
                prompt: input.prompt,
                images: sourceImages,
                ...(input.size !== undefined ? { size: input.size } : {}),
                ...(input.quality ? { quality: input.quality } : {}),
                n: input.n,
                ...(input.webSearch !== undefined ? { webSearch: input.webSearch } : {}),
                ...(input.sequential !== undefined ? { sequential: input.sequential } : {}),
              })
            : await client.generateImagesWithReceipt(options.token!, input);
        return receipt.images.map((image) => ({
          url: image.url,
          width: input.width ?? null,
          height: input.height ?? null,
          ...(receipt.requestId ? { requestId: receipt.requestId } : {}),
        }));
      } catch (error) {
        if (error instanceof NewApiError) {
          // IKBQEE：余额不足识别——不只看 402，也认 new-api 中文「预扣费额度失败/用户剩余额度」
          // 与英文 quota/balance/insufficient（job 1565「预扣费额度失败」为 HTTP200+body 报错，非 402）。
          // IKDAJN：版权/敏感（copyright/sensitive）优先于 quota 判定，归 content_rejected。
          const text = String(error.message);
          const code = isContentPolicySignal(text)
            ? ERROR_CONTENT_REJECTED
            : isQuotaSignal(text, error.status)
              ? ERROR_QUOTA_EXHAUSTED
              : ERROR_PROVIDER_FAILED;
          throw new ImageProviderError(code, error.message);
        }
        throw new ImageProviderError(
          ERROR_PROVIDER_FAILED,
          error instanceof Error ? error.message : "unknown",
        );
      }
    },
  };
}

/** 默认走 new-api relay；直连 Ark 只能由 GENERATION_PROVIDER=ark 显式开启。 */
export function createGenerationImageProvider(
  options: ProviderOptions = {},
): ImageProvider {
  const env = options.env ?? process.env;
  if (env.GENERATION_PROVIDER === "ark") {
    return createArkImageProvider(options);
  }
  return createNewApiImageProvider(options);
}
