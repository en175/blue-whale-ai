import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  WEBSITE_JSON_LD,
  titleForPath,
} from './site';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function attr(html: string, name: string): string | undefined {
  return html.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

describe('titleForPath', () => {
  it('首页使用完整站点标题', () => {
    expect(titleForPath('/')).toBe(SITE_TITLE);
    expect(titleForPath('')).toBe(SITE_TITLE);
  });

  it.each([
    ['/canvas', `画布 | ${SITE_NAME}`],
    ['/projects', `项目 | ${SITE_NAME}`],
    ['/library', `资产 | ${SITE_NAME}`],
    ['/account/credits', `账户积分与订单 | ${SITE_NAME}`],
    ['/admin', `管理后台 | ${SITE_NAME}`],
    ['/admin/users', `管理后台 | ${SITE_NAME}`],
  ] as const)('%s → %s', (path, expected) => {
    expect(titleForPath(path)).toBe(expected);
  });

  it('未知路径回落到站点标题', () => {
    expect(titleForPath('/not-a-page')).toBe(SITE_TITLE);
  });
});

describe('index.html SEO', () => {
  const html = readFileSync(join(webRoot, 'index.html'), 'utf8');

  it('标题对齐站点文案，不再使用包名或空泛品类词', () => {
    expect(html).toContain(`<title>${SITE_TITLE}</title>`);
    expect(html).not.toContain('blue_whale_web');
    expect(html).not.toContain('蓝鲸创意创作平台');
    expect(SITE_TITLE).toContain(SITE_NAME);
    expect(SITE_TITLE).toMatch(/Agent|视频/);
  });

  it('描述与 Open Graph / Twitter 卡片一致', () => {
    expect(attr(html, 'name="description" content')).toBe(SITE_DESCRIPTION);
    expect(attr(html, 'name="keywords" content')).toBe(SITE_KEYWORDS);
    expect(attr(html, 'property="og:title" content')).toBe(SITE_TITLE);
    expect(attr(html, 'property="og:description" content')).toBe(SITE_DESCRIPTION);
    expect(attr(html, 'property="og:site_name" content')).toBe(SITE_NAME);
    expect(attr(html, 'name="twitter:card" content')).toBe('summary');
    expect(attr(html, 'name="twitter:title" content')).toBe(SITE_TITLE);
    expect(SITE_DESCRIPTION.length).toBeGreaterThanOrEqual(70);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(120);
  });

  it('JSON-LD 与站点常量一致', () => {
    const raw = html.match(
      /<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/,
    )?.[1];
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual(WEBSITE_JSON_LD);
  });
});

describe('robots.txt', () => {
  const robots = readFileSync(join(webRoot, 'public/robots.txt'), 'utf8');

  it('允许收录首页，屏蔽后台与登录后工作台', () => {
    expect(robots).toMatch(/User-agent:\s*\*/);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/admin$/m);
    expect(robots).toMatch(/^Disallow: \/canvas$/m);
    expect(robots).toMatch(/^Disallow: \/projects$/m);
    expect(robots).toMatch(/^Disallow: \/library$/m);
  });
});
