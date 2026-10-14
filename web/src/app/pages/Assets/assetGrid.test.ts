import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '@/api/assets';
import { appendUniqueAssets, assetAspectRatio, hasNextAssetPage } from './assetGrid';

const image = (id: number, width: number | null, height: number | null): AssetRecord => ({
  id,
  type: 'image',
  url: `https://example.test/${id}.png`,
  width,
  height,
  duration: null,
  source: 'generated',
  model: null,
  created_at: null,
});

describe('assetGrid helpers', () => {
  it('uses asset dimensions and falls back to a square ratio for invalid metadata', () => {
    expect(assetAspectRatio(image(1, 1920, 1080))).toBe('1920 / 1080');
    expect(assetAspectRatio(image(2, null, 1080))).toBe('1 / 1');
    expect(assetAspectRatio(image(3, 0, 1080))).toBe('1 / 1');
  });

  it('keeps repeated records out when consecutive pages overlap', () => {
    const first = [image(1, 100, 100), image(2, 100, 100)];
    const merged = appendUniqueAssets(first, [image(2, 100, 100), image(3, 100, 100)]);

    expect(merged.map((asset) => asset.id)).toEqual([1, 2, 3]);
  });

  it('stops loading after the server is exhausted or returns an empty page', () => {
    expect(hasNextAssetPage(60, 61, 1)).toBe(true);
    expect(hasNextAssetPage(61, 61, 1)).toBe(false);
    expect(hasNextAssetPage(60, 61, 0)).toBe(false);
  });
});
