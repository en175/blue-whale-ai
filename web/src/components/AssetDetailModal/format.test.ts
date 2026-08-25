import { describe, expect, it } from 'vitest';
import { sourceLabel, formatDuration, formatSize, formatDate } from './format';

describe('资产详情字段格式化', () => {
  it('来源映射：uploaded→用户上传 / generated→AI 生成 / 其他→未知来源', () => {
    expect(sourceLabel('uploaded')).toBe('用户上传');
    expect(sourceLabel('generated')).toBe('AI 生成');
    expect(sourceLabel('copied')).toBe('copied');
    expect(sourceLabel(null)).toBe('未知来源');
    expect(sourceLabel(undefined)).toBe('未知来源');
  });

  it('时长格式化：秒 → mm:ss；null → —', () => {
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(3723)).toBe('62:03'); // 小时进位为分钟，不显示小时
    expect(formatDuration(null)).toBe('—');
  });

  it('文件大小格式化：字节 → B/KB/MB；null → —', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(5242880)).toBe('5.0 MB');
    expect(formatSize(null)).toBe('—');
  });

  it('创建时间：ISO → 本地可读；无效/空 → —', () => {
    expect(formatDate('2026-08-01T00:00:00.000Z')).toBe(
      new Date('2026-08-01T00:00:00.000Z').toLocaleString(),
    );
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});
