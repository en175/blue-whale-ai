import { ok } from "@blue-whale/contracts";
import type { ModelCapabilityView } from "@blue-whale/persistence";

/** GET /api/generation/models：查启用模型能力列表（公开目录，无鉴权）。
 *  对齐 Java GenerationModelCapabilityService.listCapabilities；原样透传数据库行，不做任何参数裁剪。 */
export async function handleListModels(
  capability: string,
  deps: {
    models: {
      listEnabledByType(type: string): Promise<ModelCapabilityView[]>;
    };
  },
) {
  const models = await deps.models.listEnabledByType(capability);
  return ok(models);
}
