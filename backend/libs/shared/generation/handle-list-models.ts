import { ok, resolvePromptMaxLength, type PromptLengthType } from "@lib/contracts";
import type { ModelCapabilityView } from "@lib/shared/persistence/index.js";

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
  const lengthType = asPromptLengthType(capability);
  return ok(models.map((model) => toConsumerModel(model, lengthType)));
}

/** text 档不建 GenerationJob、没有提示词长度闸，不参与上限下发。 */
function asPromptLengthType(capability: string): PromptLengthType | null {
  return capability === "image" || capability === "video" || capability === "audio"
    ? capability
    : null;
}

function toConsumerModel(view: CatalogRow, lengthType: PromptLengthType | null) {
  const mapping = parseStoredImageRequestMapping(
    view.channel_parser,
    view.request_mapping,
    { sizeId: view.default_size, ratioId: view.default_aspect_ratio },
  );
  const {
    channel_parser: _parser,
    request_mapping: _mapping,
    features,
    ...rest
  } = view;
  // IKESD6 / ADR-0085：i2i_model_name 是出站调用值，与像素/api_value 同哲学对消费端剥除。
  // IKH4B8：max_prompt_length 下发的是**已算好的生效值**（模型配置优先、未配置回落缺省），
  // 消费端拿到即可直接用，不必自己知道缺省口径——目录仍是上限的唯一事实源。
  const { i2i_model_name: _alias, ...publicFeatures } = features;
  return {
    ...rest,
    features: lengthType
      ? {
          ...publicFeatures,
          max_prompt_length: resolvePromptMaxLength(lengthType, publicFeatures.max_prompt_length),
        }
      : publicFeatures,
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
