import { ok, resolvePromptMaxLength, type PromptLengthType } from "@lib/contracts";
import type { ModelCapabilityView } from "@lib/shared/persistence/index.js";

import {
  availableAspectRatiosForSize,
  channelOf,
  parseStoredChannel,
  parseStoredImageRequestMapping,
} from "./image-channel-parser.js";

type CatalogRow = ModelCapabilityView & {
  channel?: string | null;
  request_mapping?: unknown;
};

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
  return ok(models.map((model) => toConsumerModel(model, lengthType, capability)));
}

function asPromptLengthType(capability: string): PromptLengthType | null {
  return capability === "image" || capability === "video" || capability === "audio"
    ? capability
    : null;
}

function toConsumerModel(view: CatalogRow, lengthType: PromptLengthType | null, capabilityType: string) {
  const mapping = parseStoredImageRequestMapping(
    channelOf(parseStoredChannel(view.channel, capabilityType)).parser,
    view.request_mapping,
    { sizeId: view.default_size, ratioId: view.default_aspect_ratio },
  );
  const { channel: _channel, request_mapping: _mapping, features, ...rest } = view;
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
