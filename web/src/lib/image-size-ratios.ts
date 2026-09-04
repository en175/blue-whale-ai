/** 消费端图片尺寸/比例：只认展示 id 与已填组合，不露出调用值。 */

export type ConsumerSize = {
  id: string;
  label: string;
  available_aspect_ratios?: string[];
};

export type ConsumerImageModel = {
  supported_sizes: ConsumerSize[];
  supported_aspect_ratios: string[];
  default_aspect_ratio?: string | null;
};

function sameId(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/** 当前尺寸下可供用户选择的比例。新契约走 size.available_aspect_ratios；旧接口回退全量比例。 */
export function ratiosForSelectedSize(model: ConsumerImageModel, sizeId: string): string[] {
  const size = model.supported_sizes.find((item) => sameId(item.id, sizeId));
  if (size && Array.isArray(size.available_aspect_ratios)) {
    return size.available_aspect_ratios;
  }
  return model.supported_aspect_ratios;
}

/** 尺寸切换后夹取比例：保留仍可用的当前值，否则默认比例，再否则第一项。 */
export function pickRatioForSize(
  model: ConsumerImageModel,
  sizeId: string,
  current?: string | null,
): string {
  const ratios = ratiosForSelectedSize(model, sizeId);
  if (current && ratios.includes(current)) return current;
  if (model.default_aspect_ratio && ratios.includes(model.default_aspect_ratio)) {
    return model.default_aspect_ratio;
  }
  return ratios[0] ?? '';
}
