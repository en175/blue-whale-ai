/** 视频生成 provider 端口：提交异步任务并等待终态。 */
export interface GenerateVideoInput {
  model: string;
  prompt: string;
  duration: number;
  width: number;
  height: number;
  resolution: string;
  ratio: string;
  /** 已通过项目/用户归属校验的图片，使用 URL 或 data URI。 */
  image?: string;
}

export interface GeneratedVideo {
  url: string;
  width: number | null;
  height: number | null;
}

export interface VideoProvider {
  generate(input: GenerateVideoInput): Promise<GeneratedVideo>;
}

export class VideoProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VideoProviderError";
  }
}
