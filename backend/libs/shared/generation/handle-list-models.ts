import { ok } from "@blue-whale/contracts";
import type { ModelCapabilityView } from "@blue-whale/persistence";

import {
  availableAspectRatiosForSize,
  parseStoredImageRequestMapping,
} from "./image-channel-parser.js";

type CatalogRow = ModelCapabilityView & {
  channel_parser?: string | null;
  request_mapping?: unknown;
};

/** GET /api/generation/models：查启用模型能力列表（公开目录，无鉴权）。
 *  消费端只返尺寸/比例展示 id、label 与已填组合；不返调用值。 */
export async function handleListModels(
  capability: string,
  deps: {
    models: {
      listEnabledByType(type: string): Promise<CatalogRow[]>;
    };
  },
) {
  const models = await deps.models.listEnabledByType(capability);
  return ok(models.map(toConsumerModel));
}

function toConsumerModel(view: CatalogRow) {
  const mapping = parseStoredImageRequestMapping(
    view.channel_parser,
    view.request_mapping,
    { sizeId: view.default_size, ratioId: view.default_aspect_ratio },
  );
  const {
    channel_parser: _parser,
    request_mapping: _mapping,
    ...rest
  } = view;
  return {
    ...rest,
    supported_sizes: view.supported_sizes.map((size) => ({
      id: size.id,
      label: size.label,
      available_aspect_ratios: availableAspectRatiosForSize(
        mapping,
        size.id,
        view.supported_aspect_ratios,
      ),
    })),
  };
}
