/* ============================================
 * 价格预览（Quote）接口：生成前问一次「这次预计消耗多少积分」
 *
 * ⚠️ **独立于 jobs.ts**：那些生成链路的老测试对 `@/api/jobs` 做的是**部分 mock**（只列
 *    它们用得上的导出）。报价的查询工厂放在那里，会让「新加一个导出」变成「21 个既有
 *    测试文件一起红」——组件不该有这种连带面。放到自己的模块里，依赖关系才是显式的。
 *
 * 与创建任务**同形的定价部分**：同一个 `parameters` ⇒ 同一份规格 ⇒ 与实扣同价。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest, silentInit } from './http';
import type { GenerationJobType } from './jobs';

/** 任务类型（image/video/audio）的定义在 jobs.ts —— 这里只把它转出去，
 *  免得调用方为了一个类型再 import 一次那个模块（纯类型，编译期即擦除）。 */
export type { GenerationJobType };

/**
 * 报价（价格预览）用参数 —— 创建任务 `parameters` 里**参与定价**的那几个键。
 *
 * ⚠️ 提示词与参考素材不在其中：它们不是定价维度，后端也从规格里丢掉它们。
 *    带上提示词还会让报价的查询键随每一次打字变化（每敲一个字重新报价）。
 */
export interface QuoteJobParameters {
  model_id: string;
  /** 图片：档位 id（如 2k） */
  size?: string;
  /** 视频：分辨率档位（如 1080p） */
  resolution?: string;
  aspect_ratio?: string;
  /** 视频：时长（秒） */
  duration?: number;
  /** IKG0LP：视频是否带音频 */
  generate_audio?: boolean;
}

/** 报价请求体：与创建任务**同形**的定价部分（同一个 model、同一份规格、同一个输出数）。 */
export interface QuoteJobPayload {
  type: GenerationJobType;
  parameters: QuoteJobParameters;
  expected_output_count: number;
}

/** 报价结果：`credits` 是**整数积分**；null = 算不出价（**不要当 0 渲染**，0 会被读成免费）。 */
export interface GenerationQuote {
  credits: number | null;
}

/**
 * 价格预览 POST /api/projects/:id/generation-jobs/quote —— **只算不扣**。
 *
 * 算不出价（定价漏配 / 计费不可用）后端会降级成 `credits: null` 而不是报错，所以调用方
 * 不需要为它写错误分支：没有报价就不显示价格。
 */
export function quoteGenerationJob(
  projectId: string,
  payload: QuoteJobPayload,
  init?: { silent?: boolean },
): Promise<GenerationQuote> {
  return apiRequest<GenerationQuote>(
    `/api/projects/${encodeURIComponent(projectId)}/generation-jobs/quote`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      ...silentInit(init),
    },
  );
}

export const generationQuoteKeys = {
  all: ['generation-quote'] as const,
  /** 价只由「项目 + 类型 + 模型 + 规格 + 输出数」决定 —— 改任一项就该重新报价。 */
  quote: (projectId: string, payload: QuoteJobPayload) =>
    [...generationQuoteKeys.all, projectId, payload] as const,
};

export function generationQuoteOptions(
  projectId: string,
  payload: QuoteJobPayload,
) {
  return queryOptions({
    queryKey: generationQuoteKeys.quote(projectId, payload),
    queryFn: () => quoteGenerationJob(projectId, payload, { silent: true }),
  });
}
