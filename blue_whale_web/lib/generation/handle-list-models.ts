import { ok } from "@blue-whale/contracts";
import type { ModelCapabilityRepo } from "@blue-whale/persistence";

/** GET /api/generation/models：查启用模型能力列表。
 *  对齐 Java GenerationModelCapabilityService.listCapabilities。 */
export async function handleListModels(
  capability: string,
  deps: { models: Pick<ModelCapabilityRepo, "listEnabledByType"> },
) {
  const models = await deps.models.listEnabledByType(capability);
  return ok(models);
}
