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
          input: input.prompt,
          response_format: "mp3",
        }),
      });
      if (!response.ok) {
        throw new AudioProviderError(
          "provider_failed",
          `new-api 音频生成失败: ${response.status}`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new AudioProviderError("no_result", "生成服务未返回结果");
      }
      const contentType = response.headers.get("content-type") ?? "audio/mpeg";
      const requestId =
        response.headers.get("x-oneapi-request-id") ?? undefined;
      return {
        data: bytes,
        mime: contentType.startsWith("audio/") ? contentType : "audio/mpeg",
        ...(requestId !== undefined ? { requestId } : {}),
      };
    },
  };
}
