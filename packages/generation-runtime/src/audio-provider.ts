export interface GenerateAudioInput {
  model: string;
  prompt: string;
}

export interface GeneratedAudio {
  /** mp3 原始音频字节 */
  data: Uint8Array;
  /** 音频 mime,默认 audio/mpeg */
  mime: string;
  /** 音频时长(秒),上游可给则落 assets.duration;缺省由调用方落 null */
  duration?: number;
  /** 计费流水关联键(new-api X-Oneapi-Request-Id) */
  requestId?: string;
}

export interface AudioProvider {
  generate(input: GenerateAudioInput): Promise<GeneratedAudio>;
}

export class AudioProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AudioProviderError";
  }
}
