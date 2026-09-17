/* ============================================
 * 图片擦除（IKGOSZ / IKGOT7）：「高清 ▾」下拉「擦除」入口的门槛预检。
 * 门槛口径与高清放大同源（节点 data.width/height + onLoad 实测回填，缺失不拦）；
 * 后端创建入口（IKGOT4）按 asset 权威数据复核是权威，此处仅展示层预检。
 * ============================================ */

/** 输入尺寸上限（宽 ≤2560 且高 ≤1440）。
 *  待与 image-erase 契约同源：契约文件 backend/libs/contracts/image-erase.ts 由 IKGOT3 创建，
 *  落地后本组常量改为从 @lib/contracts/image-erase import（父代理整合时统一，勿散落复制）。 */
export const IMAGE_ERASE_MAX_WIDTH = 2560;
export const IMAGE_ERASE_MAX_HEIGHT = 1440;

/** 输入大小上限（≤10MB）。待与 image-erase 契约同源（同上）。 */
export const IMAGE_ERASE_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** 不支持擦除的格式（接口仅支持 png/jpg/jpeg/heic；上传链可产生 webp/gif，画布确有存量）。
 *  待与 image-erase 契约同源（同上）。 */
export const IMAGE_ERASE_UNSUPPORTED_FORMATS = ['webp', 'gif'] as const;

/** 门槛判定输入：与 MediaNode data 字段同名（width/height/size/mime/fileName/src）。 */
export interface ImageEraseGateSource {
  width?: number;
  height?: number;
  size?: number;
  mime?: string;
  fileName?: string;
  src?: string;
}

/** 取字符串扩展名（去 query/hash 后的最后一段，小写）；无扩展名返回 null。 */
function extOf(value: string | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const clean = value.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1).toLowerCase();
}

/** 图片格式判定（小写扩展名）：mime 优先，缺失时依次从 src / fileName 扩展名推断；
 *  识别不出返回 null（不拦，与尺寸缺失同口径：交后端按权威数据复核）。 */
export function imageEraseFormatOf(source: ImageEraseGateSource): string | null {
  if (typeof source.mime === 'string' && source.mime !== '') {
    const slash = source.mime.lastIndexOf('/');
    const subtype = (slash >= 0 ? source.mime.slice(slash + 1) : source.mime).toLowerCase();
    if (subtype !== '') return subtype;
  }
  return extOf(source.src) ?? extOf(source.fileName);
}

/** 「擦除」入口门槛预检：返回不可用原因（悬停展示），null 为可用。
 *  尺寸/大小缺失不拦（存量图宽高 null，onLoad 实测回填后按实测重判）；
 *  判定顺序：格式 → 尺寸 → 大小。 */
export function imageEraseGateReason(source: ImageEraseGateSource): string | null {
  const format = imageEraseFormatOf(source);
  if ((IMAGE_ERASE_UNSUPPORTED_FORMATS as readonly string[]).includes(format ?? '')) {
    return `${format} 格式不支持擦除（支持 PNG/JPG/JPEG/HEIC）`;
  }
  const { width, height, size } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    if (width > IMAGE_ERASE_MAX_WIDTH || height > IMAGE_ERASE_MAX_HEIGHT) {
      return `图片尺寸超过 ${IMAGE_ERASE_MAX_WIDTH}×${IMAGE_ERASE_MAX_HEIGHT}，无法擦除`;
    }
  }
  if (typeof size === 'number' && size > IMAGE_ERASE_MAX_SIZE_BYTES) {
    return '图片超过 10MB，无法擦除';
  }
  return null;
}
