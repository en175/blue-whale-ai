import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'b', 'i', 'u', 'strong', 'em', 's',
  'h1', 'h2', 'h3',
  'ul', 'ol', 'li',
  'br', 'span', 'div', 'p', 'font',
];

const ALLOWED_ATTRS = ['style', 'class'];

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    ALLOW_DATA_ATTR: false,
  });
}
