import { ok } from "@blue-whale/contracts";
import type { ModelCapabilityView } from "@blue-whale/persistence";
import { listSeedreamSizes } from "./seedream-image-size.js";

const IMAGE_WORKER_QUANTITY_MAX = 4;

/** GET /api/generation/models：查启用模型能力列表（公开目录，无鉴权）。
 *  对齐 Java GenerationModelCapabilityService.listCapabilities；image 类型做 Seedream 尺寸收窄 + 数量上限。 */
export async function handleListModels(
  capability: string,
  deps: {
    models: {
      listEnabledByType(type: string): Promise<ModelCapabilityView[]>;
    };
  },
) {
  const models = await deps.models.listEnabledByType(capability);
  if (capability !== "image") return ok(models);

  return ok(
    models.map((model) => {
      const supportedSizeIds = listSeedreamSizes(model.model_id);
      const features = {
        ...model.features,
        quantity_max: Math.min(
          model.features.quantity_max,
          IMAGE_WORKER_QUANTITY_MAX,
        ),
      };
      if (supportedSizeIds.length === 0) return { ...model, features };

      const allowed = new Set(supportedSizeIds);
      const supportedSizes = model.supported_sizes.filter((size) =>
        allowed.has(size.id.toLowerCase()),
      );
      const defaultSize = allowed.has(model.default_size.toLowerCase())
        ? model.default_size
        : (supportedSizes[0]?.id ?? model.default_size);

      return {
        ...model,
        features,
        supported_sizes: supportedSizes,
        default_size: defaultSize,
      };
    }),
  );
}
