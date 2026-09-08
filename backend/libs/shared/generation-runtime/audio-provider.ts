/** IKE4GC：seed-audio 参考素材——由 worker 已解析为 audio_url/image_url 二选一字段。
 *  音频参考（type:audio）→ audio_url；图片参考（type:image）→ image_url。 */
export interface SeedAudioReference {
  audio_url?: string;
  image_url?: string;
}

export interface GenerateAudioInput {
  model: string;
  prompt: string;
  /** IKE4GC：seed-audio《references》数组（音频≤3 + 图片≤1，二者不可混用），
   *  由 worker 解析填充；缺省无（纯文本生成）。text_prompt 的 @AudioN/@ImageN 标记由前端负责，后端不改。 */
  references?: SeedAudioReference[];
}

export interface GeneratedAudio {
  /** 官方返回的音频地址(带签名,~2h 有效) */
  url: string | null;
  /** 官方返回的 base64 解码字节;url 与 data 至少一个可用 */
  data?: Uint8Array;
  /** 音频 mime,默认 audio/mpeg */
  mime: string;
  /** 音频时长(秒,官方 duration;计费 original_duration 口径) */
  duration?: number;
  /** 计费流水关联键(仅当 new-api 透传层回 X-Oneapi-Request-Id;官方不回) */
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
