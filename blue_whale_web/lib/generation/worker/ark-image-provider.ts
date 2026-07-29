import {
  ArkImageError,
  NewApiError,
  createNewApiClient,
  generateImages,
  loadArkImageConfig,
} from "@blue-whale/core";

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
      if (input.sourceImage) {
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
  const client = createNewApiClient({ baseUrl, fetchImpl: options.fetchImpl });
  return {
    async generate(input) {
      try {
        const images = input.sourceImage
          ? await client.editImages(options.token!, {
              model: input.model,
              prompt: input.prompt,
              image: input.sourceImage.blob,
              fileName: input.sourceImage.fileName,
              size: input.size,
              n: input.n,
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
