/** 图片生成 provider 端口：worker 调它出图。可换实现（Ark / mock）。 */

export interface GenerateImageInput {
  model: string;
  prompt: string;
  size?: string | null;
  n: number;
  webSearch?: boolean;
  sequential?: boolean;
  /** 能力表给出的尺寸宽高（url 模式 provider 不回宽高时兜底）。 */
  width?: number | null;
  height?: number | null;
  /** 已通过项目/用户归属校验的输入图片。存在时走 image edits。 */
  sourceImage?: {
    blob: Blob;
    fileName: string;
  };
  /** Ordered, authorized reference images. */
  sourceImages?: Array<{
    blob: Blob;
    fileName: string;
  }>;
}

export interface GeneratedImage {
  url: string;
  width: number | null;
  height: number | null;
  /** IK7G9X：本次调用的 new-api request_id（消费流水精确关联键）；非 new-api 渠道为 undefined。 */
  requestId?: string;
}

export interface ImageProvider {
  generate(input: GenerateImageInput): Promise<GeneratedImage[]>;
}

export class ImageProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImageProviderError";
  }
}
