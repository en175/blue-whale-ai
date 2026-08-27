/**
 * HTML 净化工具 — 统一防 XSS 注入
 * 使用 DOMPurify 过滤危险标签与事件属性，保留富文本格式化
 */
import DOMPurify from 'dompurify';

/** 允许的标签：覆盖 TextNode 已实现的富文本功能 */
const ALLOWED_TAGS = [
  'b', 'i', 'u', 'strong', 'em', 's',
  'h1', 'h2', 'h3',
  'ul', 'ol', 'li',
  'br', 'span', 'div', 'p', 'font',
];

/** 允许的属性：style（DOMPurify 自动净化 CSS 值，移除 expression/javascript 等）和 class */
const ALLOWED_ATTRS = ['style', 'class'];

/**
 * 净化 HTML，移除所有危险标签和事件属性
 * DOMPurify 默认行为：
 * - 移除 <script>, <iframe>, <object>, <embed>, <form>, <input> 等危险标签
 * - 移除所有 on* 事件属性（onclick, onerror 等）
 * - 移除 javascript:, vbscript:, data: 等危险 URL
 * - 自动净化 style 属性中的 CSS 值（移除 expression() 等）
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    ALLOW_DATA_ATTR: false,
  });
}
