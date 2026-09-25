import { describe, expect, it } from 'vitest';
import { TASK_TYPE_LABELS, TASK_TYPE_OPTIONS, taskTypeLabel } from './taskTypeLabels';

describe('taskTypeLabel', () => {
  it('已知类型给中文名', () => {
    expect(taskTypeLabel('video')).toBe('视频');
    expect(taskTypeLabel('video_subtitle_erase')).toBe('视频去字幕');
    expect(taskTypeLabel('audio_trim')).toBe('音频截取');
  });

  it('★ 未收录的类型回退成原始 key，**不返回空、不返回 undefined**', () => {
    // 类型是自由文本：库里完全可能出现前端还没收录的新类型。
    // 显示 video_matting_2 只是不好看；显示空白或 undefined 是没法排查
    expect(taskTypeLabel('brand_new_type')).toBe('brand_new_type');
    expect(taskTypeLabel('')).toBe('');
  });

  it('标签表里没有空值', () => {
    for (const [key, label] of Object.entries(TASK_TYPE_LABELS)) {
      expect(label.trim(), `类型 ${key} 的中文名为空`).not.toBe('');
    }
  });
});

describe('TASK_TYPE_OPTIONS', () => {
  it('首项是「全部类型」，值为**空串**（不是哨兵值 all）', () => {
    // 'all' 是真值，判空时会实打实地当成一个类型发给后端，把列表过滤成空
    expect(TASK_TYPE_OPTIONS[0]).toEqual({ value: '', label: '全部类型' });
    expect(TASK_TYPE_OPTIONS.some((o) => o.value === 'all')).toBe(false);
  });

  it('每个标签表里的类型都有对应选项（筛选里能选到）', () => {
    for (const type of Object.keys(TASK_TYPE_LABELS)) {
      expect(TASK_TYPE_OPTIONS.some((o) => o.value === type), `选项里缺 ${type}`).toBe(true);
    }
  });
});
