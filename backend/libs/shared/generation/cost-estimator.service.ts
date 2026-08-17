import { Injectable } from "@nestjs/common";
import { createNewApiClient } from "@blue-whale/core";
import {
  createGenerationCostEstimator,
  type GenerationCostEstimator,
} from "./cost-estimator.js";

/** 生成成本估算器（懒加载，NEW_API_BASE_URL 未配置返回 null → 调用方降级记 0）。 */
@Injectable()
export class GenerationCostEstimatorService {
  private estimatorInstance?: GenerationCostEstimator | null;

  get estimator(): GenerationCostEstimator | null {
    if (this.estimatorInstance === undefined) {
      const baseUrl = process.env.NEW_API_BASE_URL;
      this.estimatorInstance = baseUrl
        ? createGenerationCostEstimator(createNewApiClient({ baseUrl }))
        : null;
    }
    return this.estimatorInstance;
  }
}
