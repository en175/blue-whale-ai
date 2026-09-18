/* ============================================
 * 图片抠图（IKGXLT）：「抠图」入口门槛预检、按场景两档精校与发送参数组装（纯逻辑，
 * 无 React 依赖，形状与判定口径对齐 imageErase.ts）。
 * 常量本地集中单处定义：须与 backend/libs/contracts/image-cutout.ts 契约常量同源对齐
 * （契约票 IKGXLS 并行进行中，契约合入后切换为 @lib/contracts/image-cutout 引用并统一对账；
 * 数值出处 = 官方 PDF remove-image-background「图像输入分辨率 / 文件大小 / 支持格式」节）。
 * ============================================ */

/* ============ 常量（集中单处定义，对齐注释见上） ============ */

/** 支持的抠图输入格式（白名单 png/jpg/jpeg/heic，不含 webp/gif；门槛判定按白名单反转：
 *  识别出格式且不在白名单即置灰，识别不出（null）不拦，交后端按权威数据复核）。 */
export const IMAGE_CUTOUT_INPUT_FORMATS = ['png', 'jpg', 'jpeg', 'heic'] as const;

/** 输入大小上限：单张 ≤30MB。 */
export const IMAGE_CUTOUT_MAX_FILE_BYTES = 30 * 1024 * 1024;

/** 通用场景（general）分辨率上限：长边 ≤10240px、短边 ≤6000px、总像素 ≤40MP。
 *  与擦除的差异：官方抠图接口无最小边下限，不做 MIN_SIDE 判定。 */
export const IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX = 10240;
export const IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX = 6000;
export const IMAGE_CUTOUT_GENERAL_MAX_PIXELS = 40_000_000;

/** 人像/商品场景（human/product）更严上限：长边 ≤7680px、短边 ≤4320px（两档口径，
 *  规格 Implementation Decisions「参数映射」；总像素无独立上限——该档边长上限乘积
 *  7680×4320≈33.2MP 已被通用档 40MP 覆盖）。 */
export const IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX = 7680;
export const IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX = 4320;

/** 描边宽度区间与默认（规格故事 11：滑杆 1~50px 默认 10px；官方 PDF contour_size
 *  取值 [1,100] 默认 10，本仓按规格收严到 1~50）。 */
export const IMAGE_CUTOUT_CONTOUR_SIZE_MIN = 1;
export const IMAGE_CUTOUT_CONTOUR_SIZE_MAX = 50;
export const IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT = 10;

/** 描边颜色固定白色（规格 Out of Scope：不做取色器）。 */
export const IMAGE_CUTOUT_CONTOUR_COLOR = '#FFFFFF';

/** 输出格式固定 png（规格：透明背景需要，jpeg 透明填黑与 webp 下游不兼容被否决）。 */
export const IMAGE_CUTOUT_OUTPUT_FORMAT = 'png';

/** 抠图场景三值（官方 PDF scene 必选三值，直传）。 */
export const IMAGE_CUTOUT_SCENES = ['general', 'human', 'product'] as const;
export type ImageCutoutScene = (typeof IMAGE_CUTOUT_SCENES)[number];

/* ============ 门槛预检（形状对齐 imageErase.ts） ============ */

/** 门槛判定输入：与 MediaNode data 字段同名（width/height/size/mime/fileName/src）。 */
export interface ImageCutoutGateSource {
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
export function imageCutoutFormatOf(source: ImageCutoutGateSource): string | null {
  if (typeof source.mime === 'string' && source.mime !== '') {
    const slash = source.mime.lastIndexOf('/');
    const subtype = (slash >= 0 ? source.mime.slice(slash + 1) : source.mime).toLowerCase();
    if (subtype !== '') return subtype;
  }
  return extOf(source.src) ?? extOf(source.fileName);
}

/** 支持格式提示文案（白名单渲染，悬停用）。 */
const SUPPORTED_FORMATS_LABEL = IMAGE_CUTOUT_INPUT_FORMATS.map((f) => f.toUpperCase()).join(' / ');

/** 「抠图」入口门槛预检（菜单置灰用，通用档）：返回不可用原因（悬停展示），null 为可用。
 *  尺寸/大小缺失不拦（存量图宽高 null，onLoad 实测回填后重判）；
 *  判定顺序：格式 → 尺寸（通用场景上限）→ 大小；无最小边判定（与擦除的差异）。 */
export function imageCutoutGateReason(source: ImageCutoutGateSource): string | null {
  const format = imageCutoutFormatOf(source);
  if (format !== null && !(IMAGE_CUTOUT_INPUT_FORMATS as readonly string[]).includes(format)) {
    return `${format} 格式不支持抠图（支持 ${SUPPORTED_FORMATS_LABEL}）`;
  }
  const { width, height, size } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (
      longSide > IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX
      || shortSide > IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX
      || width * height > IMAGE_CUTOUT_GENERAL_MAX_PIXELS
    ) {
      return `图片长边超过 ${IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX} 或短边超过 ${IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX} 或总像素超过 4000 万，无法抠图`;
    }
  }
  if (typeof size === 'number' && size > IMAGE_CUTOUT_MAX_FILE_BYTES) {
    return '图片超过 30MB，无法抠图';
  }
  return null;
}

/** 按场景精校（发送钮置灰用，规格故事 15）：human/product 档按更严上限重判长边/短边；
 *  general 恒 null（菜单门槛已按通用档判过，不重复）；宽高缺失不拦（同门槛口径，
 *  交后端按权威数据复核）。本票交付函数与测试，发送钮接线归后续票。 */
export function imageCutoutSceneGateReason(
  source: ImageCutoutGateSource,
  scene: ImageCutoutScene,
): string | null {
  if (scene === 'general') return null;
  const { width, height } = source;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (
    longSide > IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX
    || shortSide > IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX
  ) {
    return `图片长边超过 ${IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX} 或短边超过 ${IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX}，无法以当前场景抠图`;
  }
  return null;
}

/* ============ 发送参数组装（纯逻辑，接线归后续票 IKGXMT） ============ */

/** 参数组装输入（camelCase 入参，产出 snake_case 请求体）。 */
export interface BuildImageCutoutRequestInput {
  /** 源素材身份（Asset id 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId: string;
  /** 目标节点身份（画布抠图结果卡 node id，发送时由前端生成传入） */
  targetNodeId: string;
  /** 抠图场景（general/human/product 直传） */
  scene: ImageCutoutScene;
  /** 主体描边开关（仅 human/product 生效） */
  needContour?: boolean;
  /** 描边宽度（px）：钳制到 1~50，缺省 10 */
  contourSize?: number;
  /** 透明背景裁剪开关（仅 human/product 生效） */
  needCropBackground?: boolean;
}

/** 通用场景请求体（四键，无增强参数）。 */
export interface ImageCutoutGeneralRequest {
  source_asset_id: string;
  target_node_id: string;
  cutout_scene: 'general';
  output_format: typeof IMAGE_CUTOUT_OUTPUT_FORMAT;
}

/** 人像/商品场景请求体（四键 + 增强四参数）。 */
export interface ImageCutoutSubjectRequest {
  source_asset_id: string;
  target_node_id: string;
  cutout_scene: 'human' | 'product';
  output_format: typeof IMAGE_CUTOUT_OUTPUT_FORMAT;
  need_contour: boolean;
  contour_color: string;
  contour_size: number;
  need_crop_background: boolean;
}

/** 抠图发送参数（snake_case 请求体，判别联合对应契约 strict schema 口径：
 *  通用分支带增强键即拒）。 */
export type ImageCutoutRequest = ImageCutoutGeneralRequest | ImageCutoutSubjectRequest;

/** 抠图发送参数组装：scene 直传三值；通用场景不携带 need_contour/contour_color/
 *  contour_size/need_crop_background 四参数（接口对 general 忽略，请求体不带忽略字段，
 *  规格故事 29）；描边宽度钳制 1~50 默认 10；contour_color 固定白色；output_format
 *  固定 png；queue_id 不传。重载按场景窄化返回形态。 */
export function buildImageCutoutRequest(
  input: BuildImageCutoutRequestInput & { scene: 'human' | 'product' },
): ImageCutoutSubjectRequest;
export function buildImageCutoutRequest(
  input: BuildImageCutoutRequestInput & { scene: 'general' },
): ImageCutoutGeneralRequest;
export function buildImageCutoutRequest(input: BuildImageCutoutRequestInput): ImageCutoutRequest {
  const { sourceAssetId, targetNodeId, scene } = input;
  if (scene === 'general') {
    return {
      source_asset_id: sourceAssetId,
      target_node_id: targetNodeId,
      cutout_scene: scene,
      output_format: IMAGE_CUTOUT_OUTPUT_FORMAT,
    };
  }
  const raw = typeof input.contourSize === 'number' && Number.isFinite(input.contourSize)
    ? input.contourSize
    : IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT;
  const contourSize = Math.min(IMAGE_CUTOUT_CONTOUR_SIZE_MAX, Math.max(IMAGE_CUTOUT_CONTOUR_SIZE_MIN, raw));
  return {
    source_asset_id: sourceAssetId,
    target_node_id: targetNodeId,
    cutout_scene: scene,
    output_format: IMAGE_CUTOUT_OUTPUT_FORMAT,
    need_contour: input.needContour === true,
    contour_color: IMAGE_CUTOUT_CONTOUR_COLOR,
    contour_size: contourSize,
    need_crop_background: input.needCropBackground === true,
  };
}
