export interface NewApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  traceIdProvider?: () => string | null | Promise<string | null>;
}

export interface NewApiImageInput {
  model: string;
  prompt: string;
  size?: string | null;
  quality?: string;
  n: number;
  webSearch?: boolean;
  sequential?: boolean;
  image?: string | readonly string[];
}

export interface NewApiImage {
  url: string;
  [key: string]: unknown;
}

export interface NewApiImageEditInput {
  model: string;
  prompt: string;
  image?: Blob;
  fileName?: string;
  images?: Array<{ blob: Blob; fileName: string }>;
  size?: string | null;
  quality?: string;
  n: number;
  webSearch?: boolean;
  sequential?: boolean;
}

export type NewApiVideoReference = {
  type: "image" | "video" | "audio";
  url: string;
  role?: "first_frame" | "last_frame";
};

export interface NewApiVideoInput {
  model: string;
  prompt: string;
  image?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages?: string[];
  references?: NewApiVideoReference[];
  duration: number;
  width: number;
  height: number;
  resolution: string;
  ratio: string;
  responseFormat?: "url";
}

export interface NewApiVideoSubmission {
  taskId: string;
  status: string;
}

export interface NewApiVideoTask {
  taskId: string;
  status: string;
  url: string | null;
  quota?: number;
  error: { code: string | number | null; message: string } | null;
}

export interface NewApiPricingItem {
  modelName: string;
  modelPrice?: number;
  modelRatio?: number;
  billingMode?: string;
  billingExpr?: string;
}

export interface NewApiPricingResult {
  pricing: NewApiPricingItem[];
  pricingVersion?: string;
}
