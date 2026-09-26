/* ============================================
 * 价格预览（Quote）接口：生成前问一次「这次预计消耗多少积分」
 *
 * ⚠️ **独立于 jobs.ts**：那些生成链路的老测试对 `@/api/jobs` 做的是**部分 mock**（只列
 *    它们用得上的导出）。报价的查询工厂放在那里，会让「新加一个导出」变成「21 个既有
 *    测试文件一起红」——组件不该有这种连带面。放到自己的模块里，依赖关系才是显式的。
 *
 * 与创建任务**同形的定价部分**：同一个 `parameters` + 同一份参考 ⇒ 同一份规格 ⇒ 与实扣同价。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest, silentInit } from './http';
import type { GenerationJobType, GenerationRefItem } from './jobs';

/** 任务类型（image/video/audio）的定义在 jobs.ts —— 这里只把它转出去，
 *  免得调用方为了一个类型再 import 一次那个模块（纯类型，编译期即擦除）。 */
export type { GenerationJobType };

/**
 * 报价（价格预览）用参数 —— 创建任务 `parameters` 里**参与定价**的那几个键。
 *
 * ⚠️ 提示词不在此列：它不是定价维度，后端也从规格里丢掉它。
 *    带上提示词还会让报价的查询键随每一次打字变化（每敲一个字重新报价）。
 *    （参考素材**是**定价维度，只是不走 `parameters` 而走下面的 `references`。）
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

/** 报价请求体：与创建任务**同形**的定价部分（同一个 model、同一份规格、同一份参考、同一个输出数）。 */
export interface QuoteJobPayload {
  type: GenerationJobType;
  parameters: QuoteJobParameters;
  expected_output_count: number;
  /**
   * 参考素材（与创建任务同形、同源）：**参考图是定价维度** —— Seedream 5.0 Pro 官方
   * 「参考图首张免费、第 2 张起 0.02 元/张」，后端按规格里的 `reference_count` 加价
   * （图片单读 `input.input_asset_ids`，视频/音频读 `references`）。
   * 不带参考，预览价就会比实扣价少。
   *
   * ⚠️ **只送「哪些参考」，不送「几张」**：张数由后端 `resolveReferenceAssets` 去重保序后数出来
   *    （图片端按 asset_id 去重保首见）。前端自己数一份，去重口径就多了一处会分叉的实现 ——
   *    而它一分叉，用户看到的就是「预览一个价、实扣另一个价」。
   *
   * 视频参考的 `duration` 同样要带：火山 token 公式在「含视频输入」时把输入时长算进 token
   * （`GenerationRefItem.duration`），漏了它报价会按「无视频输入」估。
   */
  references?: GenerationRefItem[];
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
  /** 价只由「项目 + 类型 + 模型 + 规格 + 参考 + 输出数」决定 —— 改任一项就该重新报价
   *  （查询键就是整个 payload，所以参考一换键就变，无需额外失效逻辑）。 */
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
