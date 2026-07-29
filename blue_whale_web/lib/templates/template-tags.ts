/** 模板标签枚举（对齐 Java TemplateTagEnum，单一来源）。
 *  硬编码与 Java 一致——tags 是枚举元数据，不在 DB。 */

export interface TemplateTag {
  tag_code: string;
  label: string;
  sort_order: number;
}

export const TEMPLATE_TAGS: readonly TemplateTag[] = [
  { tag_code: "marketing", label: "营销视频", sort_order: 0 },
  { tag_code: "short", label: "微短片", sort_order: 1 },
  { tag_code: "replicate", label: "视频复刻", sort_order: 2 },
  { tag_code: "social", label: "社媒视频", sort_order: 3 },
  { tag_code: "image", label: "图片设计", sort_order: 4 },
];

export function isValidTagCode(tagCode: string): boolean {
  return TEMPLATE_TAGS.some((t) => t.tag_code === tagCode);
}

export function listTemplateTags(): { tag_code: string; label: string }[] {
  return [...TEMPLATE_TAGS]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(({ tag_code, label }) => ({ tag_code, label }));
}
