// @vitest-environment jsdom
/* recentQualityTool（IKGZ5P「高清 ▾」触发钮最近工具记忆）：全局单值纯逻辑——
   默认「高清」、localStorage 单 key 持久、坏值/无存储读取回退、单一写入点
   （非法 id 不写）与订阅通知（跨卡片共享的刷新机制）。key 约定先例 snapPreference.ts。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RECENT_QUALITY_TOOL,
  RECENT_QUALITY_TOOL_STORAGE_KEY,
  persistRecentQualityTool,
  readRecentQualityTool,
  subscribeRecentQualityTool,
} from './recentQualityTool';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readRecentQualityTool（读取）', () => {
  it('无记录时回默认「高清」', () => {
    expect(readRecentQualityTool()).toBe('enhance');
    expect(DEFAULT_RECENT_QUALITY_TOOL).toBe('enhance');
  });

  it('persist 写入后读取返回该工具，且落 localStorage（刷新后仍可读）', () => {
    persistRecentQualityTool('cutout');
    expect(readRecentQualityTool()).toBe('cutout');
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('cutout');
  });

  it('五个工具 id 均可写入读取', () => {
    for (const id of ['enhance', 'outpaint', 'crop', 'erase', 'cutout'] as const) {
      persistRecentQualityTool(id);
      expect(readRecentQualityTool()).toBe(id);
    }
  });

  it('localStorage 坏值（手改/脏数据）读取回默认', () => {
    localStorage.setItem(RECENT_QUALITY_TOOL_STORAGE_KEY, 'nonsense');
    expect(readRecentQualityTool()).toBe('enhance');
  });

  it('无 localStorage（隐私模式/禁用存储）读取回默认不抛错', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readRecentQualityTool()).toBe('enhance');
  });
});

describe('persistRecentQualityTool（单一写入点）', () => {
  it('非法 id 忽略不写（防脏数据入 storage）', () => {
    persistRecentQualityTool('haha');
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBeNull();
    expect(readRecentQualityTool()).toBe('enhance');
  });

  it('写入后通知订阅者；退订后不再通知', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecentQualityTool(listener);
    persistRecentQualityTool('crop');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    persistRecentQualityTool('erase');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('无 localStorage 时 persist 不抛错仍通知（读取回默认）', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const listener = vi.fn();
    subscribeRecentQualityTool(listener);
    expect(() => persistRecentQualityTool('cutout')).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
