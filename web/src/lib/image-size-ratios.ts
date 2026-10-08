/** 消费端图片尺寸/比例：只认展示 id 与已填组合，不露出调用值。 */

export type AspectRatioOption = {
  id: string;
  label: string;
};

export type ConsumerSize = {
  id: string;
  label: string;
  available_aspect_ratios?: unknown;
};

export type ConsumerImageModel = {
  supported_sizes: ConsumerSize[];
  supported_aspect_ratios: unknown;
  default_aspect_ratio?: string | null;
};

function sameId(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function aspectRatioOptions(raw: unknown): AspectRatioOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AspectRatioOption[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item) out.push({ id: item, label: item });
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const option = item as { id?: unknown; label?: unknown };
      if (typeof option.id !== 'string' || !option.id) continue;
      const label =
        typeof option.label === 'string' && option.label.trim() ? option.label : option.id;
      out.push({ id: option.id, label });
    }
  }
  return out;
}

export function hasAspectRatio(raw: unknown, ratioId: string): boolean {
  return aspectRatioOptions(raw).some((ratio) => ratio.id === ratioId);
}

/** 当前尺寸下可供用户选择的比例。新契约走 size.available_aspect_ratios；旧接口回退全量比例。 */
export function ratiosForSelectedSize(
  model: ConsumerImageModel,
  sizeId: string,
): AspectRatioOption[] {
  const size = model.supported_sizes.find((item) => sameId(item.id, sizeId));
  if (size && Array.isArray(size.available_aspect_ratios)) {
    return aspectRatioOptions(size.available_aspect_ratios);
  }
  return aspectRatioOptions(model.supported_aspect_ratios);
}

/** 尺寸切换后夹取比例：保留仍可用的当前值，否则默认比例，再否则第一项。 */
export function pickRatioForSize(
  model: ConsumerImageModel,
  sizeId: string,
  current?: string | null,
): string {
  const ratioIds = ratiosForSelectedSize(model, sizeId).map((ratio) => ratio.id);
  if (current && ratioIds.includes(current)) return current;
  if (model.default_aspect_ratio && ratioIds.includes(model.default_aspect_ratio)) {
    return model.default_aspect_ratio;
  }
  return ratioIds[0] ?? '';
}
