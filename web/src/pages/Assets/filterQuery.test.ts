import { describe, expect, it } from 'vitest';
import { getAssetFilter, setAssetFilter } from './filterQuery';

describe('asset filter query', () => {
  it('reads every supported filter and falls back to all for missing or unknown values', () => {
    expect(getAssetFilter(new URLSearchParams('type=image'))).toBe('image');
    expect(getAssetFilter(new URLSearchParams('type=video'))).toBe('video');
    expect(getAssetFilter(new URLSearchParams('type=audio'))).toBe('audio');
    expect(getAssetFilter(new URLSearchParams('type=character'))).toBe('character');
    expect(getAssetFilter(new URLSearchParams('type=liveness'))).toBe('liveness');
    expect(getAssetFilter(new URLSearchParams())).toBe('all');
    expect(getAssetFilter(new URLSearchParams('type=document'))).toBe('all');
  });

  it('writes the selected filter without discarding unrelated query parameters', () => {
    expect(setAssetFilter(new URLSearchParams('source=share'), 'video').toString())
      .toBe('source=share&type=video');
  });

  it('removes type for the all filter', () => {
    expect(setAssetFilter(new URLSearchParams('type=audio&source=share'), 'all').toString())
      .toBe('source=share');
  });
});
