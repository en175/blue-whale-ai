/* ============================================
 * 音频截取遮罩几何（IKHB7A，父单 IKHB08）：截取编辑态选区/抓手/定位条的时间换算
 * 与钳制纯函数库（无 React 依赖，形状对齐 imageCrop.ts 先例；交互与视觉基准 =
 * 验收原型 web/prototypes/audio-trim.prototype.html，规格 = ADR-0111）。
 * 坐标系约定：选区一律以**秒**表达（内部全精度浮点，ADR-0111 精度三级），与显示
 * 尺寸无关——组件层 pointer 事件按 (clientX-rect.left)/rect.width * duration 换算
 * 成秒后进本模块（比例换算天然抵消画布 zoom），本文件不做像素数学。
 * 提交面（贴边省略/两位小数）在契约 @lib/contracts/audio-trim（buildAudioTrimTimeParams
 * 等），本文件只管编辑态交互几何，不 import 契约（无跨进程字段）。
 * ============================================ */

/** 最小片段秒数（工单拍板 0.1 秒钳制）：左右抓手拖拽/选区钳制的公共下限。 */
export const AUDIO_TRIM_MIN_SEGMENT_SECONDS = 0.1;

/** 截取选区（秒，内部全精度）：start ∈ [0, duration]、end ∈ [start+min, duration]。 */
export interface AudioTrimSelection {
  /** 选区左缘（秒）。 */
  start: number;
  /** 选区右缘（秒）。 */
  end: number;
}

/** 钳到 [0, limit]（时长恒非负，门槛已保证 duration > 0）。 */
function clampTime(value: number, limit: number): number {
  return Math.min(Math.max(value, 0), limit);
}

/** 进入截取编辑态的默认选区：全选 0 到全长（每次进入重置，不跨会话记忆）。 */
export function fullAudioTrimSelection(duration: number): AudioTrimSelection {
  return { start: 0, end: duration };
}

/** 选区钳制到合法态：两端各自收进 [0, duration]、且 end - start 不小于最小片段
 *  （先钳端点再补最小片段：端点越界把片段顶出去时以先钳到的一端为准让位）。
 *  duration 非法（≤0，理论上门槛已拦）时退化为 [0, min] 空转选区，不抛错。 */
export function clampAudioTrimSelection(
  selection: AudioTrimSelection,
  duration: number,
): AudioTrimSelection {
  const limit = duration > 0 ? duration : AUDIO_TRIM_MIN_SEGMENT_SECONDS;
  const start = clampTime(selection.start, limit);
  const end = clampTime(selection.end, limit);
  if (end - start < AUDIO_TRIM_MIN_SEGMENT_SECONDS) {
    // 片段不足：以 start 为锚补足最小片段，锚越界（start 贴 duration）则反向锚 end
    if (start <= limit - AUDIO_TRIM_MIN_SEGMENT_SECONDS) {
      return { start, end: start + AUDIO_TRIM_MIN_SEGMENT_SECONDS };
    }
    return { start: limit - AUDIO_TRIM_MIN_SEGMENT_SECONDS, end: limit };
  }
  return { start, end };
}

/** 拖左缘抓手（白竖条）：左缘跟随指针秒值，钳 [0, end-min]（原型 onDragMove 左支；
 *  上界由右缘决定、下界恒 0，不依赖全长，故无 duration 参数——与拖右缘的不对称
 *  是钳制域本身的不对称）。 */
export function dragAudioTrimHandleStart(
  time: number,
  selection: AudioTrimSelection,
): AudioTrimSelection {
  const start = clampTime(time, selection.end - AUDIO_TRIM_MIN_SEGMENT_SECONDS);
  return { start, end: selection.end };
}

/** 拖右缘抓手：右缘跟随指针秒值，钳 [start+min, duration]（原型 onDragMove 右支）。 */
export function dragAudioTrimHandleEnd(
  time: number,
  selection: AudioTrimSelection,
  duration: number,
): AudioTrimSelection {
  const end = Math.min(
    Math.max(time, selection.start + AUDIO_TRIM_MIN_SEGMENT_SECONDS),
    duration,
  );
  return { start: selection.start, end };
}

/** 播放头（红色定位条）钳制：选区内可点可拖，越界钳回最近边界（原型 phSeekFromEvent）。 */
export function clampAudioTrimPlayhead(
  time: number,
  selection: AudioTrimSelection,
): number {
  return Math.min(Math.max(time, selection.start), selection.end);
}

/** 指针秒值是否落在选区内（容差 1e-6 抵消浮点尾差，对齐原型 +1e-6 口径）。 */
export function isAudioTrimTimeInSelection(
  time: number,
  selection: AudioTrimSelection,
): boolean {
  return time >= selection.start - 1e-6 && time <= selection.end + 1e-6;
}

/** 时间 → 波形区宽度百分比（选区框/暗区/抓手/定位条渲染共用）。 */
export function audioTrimTimePercent(time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return (time / duration) * 100;
}

/** 选区秒数文案（中央黑底胶囊，一位小数）：如 10.6 s（原型 pill）。 */
export function audioTrimDurationLabel(selection: AudioTrimSelection): string {
  return `${(selection.end - selection.start).toFixed(1)} s`;
}

/** 分:秒（卡内时间行，如 0:02 / 0:15）——AudioPlayer 既有 formatTime 同款，供
 *  发送条/遮罩测试断言与潜在展示复用；+1e-6 容差抵消手柄拖拽的浮点误差。 */
export function formatAudioTrimClock(seconds: number): string {
  const s = Math.floor(seconds + 1e-6);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 发送条时间范围文案（mm:ss，两位补零，如 00:02 - 00:13；原型 fmtPad 口径）。 */
export function audioTrimRangeLabel(selection: AudioTrimSelection): string {
  const pad = (seconds: number) => {
    const s = Math.floor(seconds + 1e-6);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  return `${pad(selection.start)} - ${pad(selection.end)}`;
}
