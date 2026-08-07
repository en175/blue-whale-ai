import {
  ArkImageError,
  NewApiError,
  generateImages,
  loadArkImageConfig,
} from "@blue-whale/core";
import { createWebNewApiClient } from "@/lib/logging";

import {
  ImageProviderError,
  type GenerateImageInput,
  type GeneratedImage,
  type ImageProvider,
} from "./image-provider";

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
          "unsupported_input",
          "Ark fallback 不支持图片编辑输入",
        );
      }
      try {
        const result = await generateImages(
          config,
          {
            model: input.model,
            prompt: input.prompt,
            size: input.size ?? undefined,
            n: input.n,
            webSearch: input.webSearch,
            sequential: input.sequential,
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
          "provider_failed",
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
          "provider_config",
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
  const client = createWebNewApiClient({
    baseUrl,
    fetchImpl: options.fetchImpl,
    timeoutMs,
  });
  return {
    async generate(input) {
      try {
        const sourceImages =
          input.sourceImages ?? (input.sourceImage ? [input.sourceImage] : []);
        const images =
          sourceImages.length > 0
            ? await client.editImages(options.token!, {
                model: input.model,
                prompt: input.prompt,
                images: sourceImages,
                size: input.size,
                n: input.n,
                webSearch: input.webSearch,
                sequential: input.sequential,
              })
            : await client.generateImages(options.token!, input);
        return images.map((image) => ({
          url: image.url,
          width: input.width ?? null,
          height: input.height ?? null,
        }));
      } catch (error) {
        if (error instanceof NewApiError) {
          const code =
            error.status === 402 ? "quota_exhausted" : "provider_failed";
          throw new ImageProviderError(code, error.message);
        }
        throw new ImageProviderError(
          "provider_failed",
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
