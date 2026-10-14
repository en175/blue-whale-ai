
export const SITE_NAME = '蓝鲸';

export const SITE_TITLE = '蓝鲸 | 任意视频，告诉 Agent 即可创建';

export const SITE_DESCRIPTION =
  '用一句话告诉 Agent，即可创建任意视频与图像。蓝鲸把对话式创作、画布编排和生成工作流连在一起，帮你从想法做到成片，覆盖营销短片、社媒视频与图片设计。';

export const SITE_KEYWORDS = '蓝鲸,AI视频,AI Agent,视频生成,图像生成,AI创作';

const ROUTE_PAGE_TITLES: Record<string, string> = {
  canvas: '画布',
  projects: '项目',
  library: '资产',
  account: '账户积分与订单',
};

export const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  alternateName: 'Blue Whale',
  description: SITE_DESCRIPTION,
} as const;

export function titleForPath(pathname: string): string {
  if (pathname.startsWith('/admin')) return `管理后台 | ${SITE_NAME}`;
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/') return SITE_TITLE;
  const key = normalized.slice(1).split('/')[0] ?? '';
  const page = ROUTE_PAGE_TITLES[key];
  return page ? `${page} | ${SITE_NAME}` : SITE_TITLE;
}
