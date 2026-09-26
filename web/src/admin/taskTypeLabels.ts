/* ============================================
 * 任务类型的中文名（管理端共用）。
 *
 * ⚠️ **只有这一份**。原先它长在 JobRecords 页里，仪表盘也要用同一套名字——
 *    两份的话漂移是必然的：加了新类型只改了筛选下拉、没改占比条，
 *    界面上会同时出现「视频去字幕」和「video_subtitle_erase」两个名字指同一件事。
 *
 * 类型本身是**自由文本**（`generation_jobs.type`，后端刻意不写死白名单——类型在演进，
 * 写死会在新增类型时误伤）。所以：
 *   · 这里是 `Record<string, string>` 而不是 `Record<JobType, string>`，
 *     编译器管不到「库里有个前端不知道的类型」这种情况；
 *   · 取名字一律走 {@link taskTypeLabel}，未收录的类型回退成**原始 key**——
 *     显示 `video_matting` 只是不好看，显示空白或 `undefined` 是没法排查。
 *
 * 编译期的类型权威在 `web/src/api/jobs.ts` 的 `JobType`；这里补的是运行期的展示名。
 * ⚠️ 新增任务类型时两处都要加：那边的联合类型 + 这里的标签（否则只是不好看，不会坏）。
 * ============================================ */

export const TASK_TYPE_LABELS: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  media_extract: '音频提取',
  image_enhance: '高清放大',
  image_erase: '图片擦除',
  image_outpaint: '智能扩图',
  image_cutout: '图片抠图',
  video_subtitle_erase: '视频去字幕',
  audio_trim: '音频截取',
  audio_mix: '音频混合',
  video_frame_interpolation: '视频插帧',
  video_matting: '视频抠像',
};

/** 任务类型 → 中文名；未收录的类型原样返回 key（**不返回空、不返回 undefined**）。 */
export function taskTypeLabel(type: string): string {
  return TASK_TYPE_LABELS[type] ?? type;
}

/**
 * 筛选下拉的类型选项（含「全部」）。
 *
 * 「全部」用**空串**表达，不是哨兵值 `'all'`：`'all'` 是真值，判空时会实打实地把它
 * 当成一个类型发给后端，列表被过滤成空（JobRecords 踩过这个坑，注释留在那里）。
 */
export const TASK_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  ...Object.entries(TASK_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];
