export type TemplateLayout = "wide" | "portrait" | "social" | "image";

export interface TemplateCard {
  title: string;
  video?: string;
  images: string[];
  layout?: TemplateLayout;
}

export interface TemplateTag {
  /** 后端 Jackson SNAKE_CASE 序列化 → tag_code（非 tagCode） */
  tag_code: string;
  label: string;
  cards?: TemplateCard[];
}

export interface TemplatePage {
  records: TemplateCard[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

/** 后端统一响应结构 */
export interface ApiResult<T> {
  code: number;
  msg: string;
  data: T;
}
