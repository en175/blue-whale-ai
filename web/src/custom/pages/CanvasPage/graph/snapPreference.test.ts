// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  persistSnapAlignmentEnabled,
  readSnapAlignmentEnabled,
  SNAP_ALIGNMENT_STORAGE_KEY,
} from './snapPreference';

afterEach(() => {
  localStorage.clear();
});

describe('吸附开关持久化', () => {
  it('无记录时默认开启', () => {
    expect(readSnapAlignmentEnabled()).toBe(true);
  });

  it("读取合法值：'off' 关、'on' 开", () => {
    localStorage.setItem(SNAP_ALIGNMENT_STORAGE_KEY, 'off');
    expect(readSnapAlignmentEnabled()).toBe(false);
    localStorage.setItem(SNAP_ALIGNMENT_STORAGE_KEY, 'on');
    expect(readSnapAlignmentEnabled()).toBe(true);
  });

  it('存储值非法时回退默认开启', () => {
    for (const bad of ['', 'true', 'false', '0', '垃圾值', 'OFF']) {
      localStorage.setItem(SNAP_ALIGNMENT_STORAGE_KEY, bad);
      expect(readSnapAlignmentEnabled(), `存储值 "${bad}" 应回退开启`).toBe(true);
    }
  });

  it('写入往返：persist 后 read 读回同一开关状态', () => {
    persistSnapAlignmentEnabled(false);
    expect(localStorage.getItem(SNAP_ALIGNMENT_STORAGE_KEY)).toBe('off');
    expect(readSnapAlignmentEnabled()).toBe(false);

    persistSnapAlignmentEnabled(true);
    expect(localStorage.getItem(SNAP_ALIGNMENT_STORAGE_KEY)).toBe('on');
    expect(readSnapAlignmentEnabled()).toBe(true);
  });
});
