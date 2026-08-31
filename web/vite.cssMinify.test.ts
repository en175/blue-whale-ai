import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const webRoot = dirname(fileURLToPath(import.meta.url));
const cssFiles = globSync('src/**/*.css', { cwd: webRoot });

function hasUnprefixedBackdropFilter(css: string): boolean {
  return css.replaceAll('-webkit-backdrop-filter', '').includes('backdrop-filter');
}

function unpairedBackdropFilters(css: string): string[] {
  const unpaired: string[] = [];
  const pattern = /(?<!-webkit-)backdrop-filter\s*:\s*([^;]+);/g;
  for (const match of css.matchAll(pattern)) {
    const after = css.slice(match.index + match[0].length).trimStart();
    if (!after.startsWith('-webkit-backdrop-filter')) {
      unpaired.push(match[0]);
    }
  }
  return unpaired;
}

describe('production CSS minify', () => {
  it('pins esbuild so dual backdrop-filter declarations survive Chromium', async () => {
    const config = await resolveConfig(
      { configFile: join(webRoot, 'vite.config.ts') },
      'build',
      'release',
    );
    expect(config.build.cssMinify).toBe('esbuild');
  });

  it('pairs every backdrop-filter with -webkit-backdrop-filter', () => {
    const missing = cssFiles.flatMap((file) => {
      const unpaired = unpairedBackdropFilters(readFileSync(join(webRoot, file), 'utf8'));
      return unpaired.map((decl) => `${file}: ${decl}`);
    });
    expect(missing).toEqual([]);
  });

  it('keeps unprefixed backdrop-filter on the homepage ChatBox after minify', async () => {
    const config = await resolveConfig(
      { configFile: join(webRoot, 'vite.config.ts') },
      'build',
      'release',
    );
    const cssTarget = config.build.cssTarget;
    const source = readFileSync(
      join(webRoot, 'src/pages/Home/components/ChatBox/index.module.css'),
      'utf8',
    );
    const { code } = await transform(source, {
      loader: 'css',
      minify: true,
      ...(typeof cssTarget === 'string' || Array.isArray(cssTarget)
        ? { target: cssTarget }
        : {}),
    });

    expect(hasUnprefixedBackdropFilter(code)).toBe(true);
    expect(code).toContain('-webkit-backdrop-filter');
  });
});
