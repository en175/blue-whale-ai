export type TemplateLayout = "wide" | "portrait" | "social" | "image";

export interface TemplateCard {
  title: string;
  video?: string;
  images: string[];
  layout?: TemplateLayout;
}

export interface TemplateTag {
  tagCode: string;
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
