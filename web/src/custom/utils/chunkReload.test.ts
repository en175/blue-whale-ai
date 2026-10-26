import { describe, expect, it } from 'vitest';
import { shouldReloadChunk } from './chunkReload';

describe('分块加载失败自动刷新的时间窗去重', () => {
  it('无历史刷新记录时允许刷新', () => {
    expect(shouldReloadChunk(0, 1_000_000)).toBe(true);
  });

  it('冷却窗口内的重复失败不再刷新，避免死循环', () => {
    expect(shouldReloadChunk(1_000_000, 1_005_000)).toBe(false);
  });

  it('冷却窗口边界（恰好等于窗口）允许再次刷新', () => {
    expect(shouldReloadChunk(1_000_000, 1_010_000)).toBe(true);
  });

  it('超出冷却窗口后允许再次刷新', () => {
    expect(shouldReloadChunk(1_000_000, 1_030_000)).toBe(true);
  });
});
