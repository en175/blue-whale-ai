/** 视频比例展示：内部键 `adaptive`（跟随输入）界面统一显示为 `auto`（IKJ4W6）。
 *
 *  仅用于**展示**。state / 草稿 / 提交参数 / 发给上游的报文里 `ratio` 仍必须是 `adaptive`：
 *  火山侧强制要求 `ratio=adaptive`（见 NewApiVideoClient），把展示名回写进请求会让视频直接失败。
 *  故展示名与内部名不同，两者不可互换。 */
const VIDEO_RATIO_DISPLAY_LABEL: Record<string, string> = {
  adaptive: 'auto',
};

/** 把视频比例内部键换成用户可见文案（未登记的值原样返回）。 */
export function videoRatioLabel(ratio: string): string {
  return VIDEO_RATIO_DISPLAY_LABEL[ratio] ?? ratio;
}
