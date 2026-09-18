import { describe, expect, it } from 'vitest';
import {
  IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT,
  IMAGE_CUTOUT_CONTOUR_SIZE_MAX,
  IMAGE_CUTOUT_CONTOUR_SIZE_MIN,
  IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX,
  IMAGE_CUTOUT_GENERAL_MAX_PIXELS,
  IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX,
  IMAGE_CUTOUT_MAX_FILE_BYTES,
  IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX,
  IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX,
  buildImageCutoutRequest,
  imageCutoutFormatOf,
  imageCutoutGateReason,
  imageCutoutSceneGateReason,
} from './imageCutout';

describe('imageCutoutFormatOf', () => {
  it('mime 优先：image/webp 与 image/gif 命中，大小写不敏感', () => {
    expect(imageCutoutFormatOf({ mime: 'image/webp' })).toBe('webp');
    expect(imageCutoutFormatOf({ mime: 'image/GIF' })).toBe('gif');
    expect(imageCutoutFormatOf({ mime: 'image/png' })).toBe('png');
  });

  it('mime 缺失时从 src 扩展名推断（去 query/hash）', () => {
    expect(imageCutoutFormatOf({ src: 'http://tos/x/y.webp?token=1' })).toBe('webp');
    expect(imageCutoutFormatOf({ src: 'http://tos/x/y.gif#frag' })).toBe('gif');
    expect(imageCutoutFormatOf({ src: 'http://tos/x/y.png' })).toBe('png');
  });

  it('再缺失时从 fileName 扩展名推断；全无返回 null', () => {
    expect(imageCutoutFormatOf({ fileName: 'photo.webp' })).toBe('webp');
    expect(imageCutoutFormatOf({})).toBeNull();
    expect(imageCutoutFormatOf({ src: 'blob:test', fileName: '无扩展名' })).toBeNull();
  });
});

describe('imageCutoutGateReason（抠图门槛预检，通用档，IKGXLT）', () => {
  it('门槛内正常图放行', () => {
    expect(
      imageCutoutGateReason({ width: 4000, height: 3000, size: 10 * 1024 * 1024, mime: 'image/png' }),
    ).toBeNull();
  });

  it('恰在边界放行（长边恰 10240 / 短边恰 6000 / 竖图对调 / 30MB / 总像素恰 40MP）', () => {
    // 三上限不可同时取边界（10240×6000=61.4MP>40MP），逐维取边界验证
    expect(imageCutoutGateReason({ width: 10240, height: 3906 })).toBeNull();
    expect(imageCutoutGateReason({ width: 6666, height: 6000 })).toBeNull();
    // 竖图长短边对调同样合法（短边/长边语义，不是宽高绑定）
    expect(imageCutoutGateReason({ width: 3906, height: 10240 })).toBeNull();
    expect(imageCutoutGateReason({ width: 6000, height: 6666 })).toBeNull();
    // 大小恰 30MB 放行
    expect(imageCutoutGateReason({ size: IMAGE_CUTOUT_MAX_FILE_BYTES, mime: 'image/png' })).toBeNull();
    // 总像素恰 40MP（8000×5000）放行
    expect(imageCutoutGateReason({ width: 8000, height: 5000 })).toBeNull();
  });

  it('长边超 10240 或短边超 6000 置灰并给出原因（横竖图同判）', () => {
    expect(imageCutoutGateReason({ width: 10241, height: 6000 })).toContain('10240');
    expect(imageCutoutGateReason({ width: 10240, height: 6001 })).toContain('6000');
    // 竖图：宽 6000 高 10241 长边超；宽 6001 高 8000 短边超
    expect(imageCutoutGateReason({ width: 6000, height: 10241 })).toContain('10240');
    expect(imageCutoutGateReason({ width: 6001, height: 8000 })).toContain('6000');
  });

  it('长短边合规但总像素超 40MP 置灰并给出原因', () => {
    // 5000×8001：长边 8001 ≤10240、短边 5000 ≤6000，总像素 40,005,000 > 40MP
    const reason = imageCutoutGateReason({ width: 5000, height: 8001 });
    expect(reason).toContain('4000 万');
    expect(reason).not.toContain('无法擦除');
  });

  it('无最小边判定（与擦除的差异）：1×1 极小图放行', () => {
    expect(imageCutoutGateReason({ width: 1, height: 1 })).toBeNull();
    expect(imageCutoutGateReason({ width: 5, height: 100 })).toBeNull();
  });

  it('超过 30MB 置灰并给出原因', () => {
    expect(imageCutoutGateReason({ size: IMAGE_CUTOUT_MAX_FILE_BYTES + 1 })).toContain('30MB');
  });

  it('webp/gif 三来源（mime/src/fileName）均置灰并说明格式不支持', () => {
    expect(imageCutoutGateReason({ mime: 'image/webp' })).toContain('webp');
    expect(imageCutoutGateReason({ src: 'http://tos/a.gif?x=1' })).toContain('gif');
    expect(imageCutoutGateReason({ fileName: 'a.webp' })).toContain('不支持抠图');
  });

  it('白名单格式 png / jpg / jpeg / heic 放行', () => {
    expect(imageCutoutGateReason({ mime: 'image/png' })).toBeNull();
    expect(imageCutoutGateReason({ mime: 'image/jpg' })).toBeNull();
    expect(imageCutoutGateReason({ mime: 'image/jpeg' })).toBeNull();
    expect(imageCutoutGateReason({ mime: 'image/heic' })).toBeNull();
  });

  it('白名单外的可识别格式同样置灰（bmp/tiff 等）', () => {
    expect(imageCutoutGateReason({ mime: 'image/bmp' })).toContain('不支持抠图');
    expect(imageCutoutGateReason({ src: 'http://tos/a.tif?x=1' })).toContain('不支持抠图');
  });

  it('尺寸 null 的存量图不拦（onLoad 实测回填后重判）', () => {
    expect(imageCutoutGateReason({ size: 1024, mime: 'image/png' })).toBeNull();
    expect(imageCutoutGateReason({ width: undefined, height: undefined })).toBeNull();
  });

  it('格式原因优先于尺寸与大小（悬停展示第一条命中的口径）', () => {
    const reason = imageCutoutGateReason({ mime: 'image/webp', width: 40000, height: 40000, size: 99 * 1024 * 1024 });
    expect(reason).toContain('webp');
  });
});

describe('imageCutoutSceneGateReason（按场景两档精校，规格故事 15）', () => {
  it('general 恒 null（菜单门槛已按通用档判过，不重复）', () => {
    expect(imageCutoutSceneGateReason({ width: 8000, height: 5000 }, 'general')).toBeNull();
    expect(imageCutoutSceneGateReason({ width: 99999, height: 99999 }, 'general')).toBeNull();
  });

  it('human/product 恰在边界（7680×4320，横竖图对调同判）放行', () => {
    for (const scene of ['human', 'product'] as const) {
      expect(imageCutoutSceneGateReason({ width: 7680, height: 4320 }, scene)).toBeNull();
      expect(imageCutoutSceneGateReason({ width: 4320, height: 7680 }, scene)).toBeNull();
    }
  });

  it('human/product 长边超 7680 或短边超 4320 置灰并给出原因', () => {
    for (const scene of ['human', 'product'] as const) {
      expect(imageCutoutSceneGateReason({ width: 7681, height: 4320 }, scene)).toContain('7680');
      expect(imageCutoutSceneGateReason({ width: 7680, height: 4321 }, scene)).toContain('4320');
      // 竖图对调同判
      expect(imageCutoutSceneGateReason({ width: 4320, height: 7681 }, scene)).toContain('7680');
      expect(imageCutoutSceneGateReason({ width: 4321, height: 4321 }, scene)).toContain('4320');
    }
  });

  it('通用档内、主体档外的图仅 human/product 拦（8000×4000 长边 8000>7680）', () => {
    expect(imageCutoutGateReason({ width: 8000, height: 4000 })).toBeNull();
    expect(imageCutoutSceneGateReason({ width: 8000, height: 4000 }, 'human')).toContain('7680');
    expect(imageCutoutSceneGateReason({ width: 8000, height: 4000 }, 'product')).toContain('7680');
  });

  it('宽高缺失不拦（同门槛口径，交后端按权威数据复核）', () => {
    expect(imageCutoutSceneGateReason({}, 'human')).toBeNull();
    expect(imageCutoutSceneGateReason({ width: 7680 }, 'product')).toBeNull();
  });

  it('边界常量与规格口径一致（7680/4320 两档数值防漂移）', () => {
    expect(IMAGE_CUTOUT_SUBJECT_MAX_LONG_SIDE_PX).toBe(7680);
    expect(IMAGE_CUTOUT_SUBJECT_MAX_SHORT_SIDE_PX).toBe(4320);
    expect(IMAGE_CUTOUT_GENERAL_MAX_LONG_SIDE_PX).toBe(10240);
    expect(IMAGE_CUTOUT_GENERAL_MAX_SHORT_SIDE_PX).toBe(6000);
    expect(IMAGE_CUTOUT_GENERAL_MAX_PIXELS).toBe(40_000_000);
  });
});

describe('buildImageCutoutRequest（发送参数组装，规格故事 29）', () => {
  it('通用场景：恰四键（source_asset_id/target_node_id/cutout_scene/output_format），不携带增强参数', () => {
    const request = buildImageCutoutRequest({ sourceAssetId: '123', targetNodeId: 'node-1', scene: 'general' });
    expect(Object.keys(request).sort()).toEqual(['cutout_scene', 'output_format', 'source_asset_id', 'target_node_id']);
    expect(request.cutout_scene).toBe('general');
    expect(request.output_format).toBe('png');
    // 即使误传增强入参，通用场景也不携带（接口对 general 忽略，请求体不带忽略字段）
    const withExtras = buildImageCutoutRequest({
      sourceAssetId: '123',
      targetNodeId: 'node-1',
      scene: 'general',
      needContour: true,
      contourSize: 20,
      needCropBackground: true,
    });
    expect(Object.keys(withExtras).sort()).toEqual(['cutout_scene', 'output_format', 'source_asset_id', 'target_node_id']);
  });

  it('人像/商品场景：追加 need_contour/contour_color/contour_size/need_crop_background 四参数', () => {
    for (const scene of ['human', 'product'] as const) {
      const request = buildImageCutoutRequest({
        sourceAssetId: '456',
        targetNodeId: 'node-2',
        scene,
        needContour: true,
        contourSize: 25,
        needCropBackground: false,
      });
      expect(Object.keys(request).sort()).toEqual([
        'contour_color',
        'contour_size',
        'cutout_scene',
        'need_contour',
        'need_crop_background',
        'output_format',
        'source_asset_id',
        'target_node_id',
      ]);
      expect(request.cutout_scene).toBe(scene);
      expect(request.need_contour).toBe(true);
      expect(request.contour_color).toBe('#FFFFFF');
      expect(request.contour_size).toBe(25);
      expect(request.need_crop_background).toBe(false);
      expect(request.output_format).toBe('png');
    }
  });

  it('描边宽度钳制：0→1、51→50、缺省→默认 10、恰在 1/50 边界保留', () => {
    expect(
      buildImageCutoutRequest({ sourceAssetId: '1', targetNodeId: 'n', scene: 'human', contourSize: 0 }).contour_size,
    ).toBe(IMAGE_CUTOUT_CONTOUR_SIZE_MIN);
    expect(
      buildImageCutoutRequest({ sourceAssetId: '1', targetNodeId: 'n', scene: 'human', contourSize: 51 }).contour_size,
    ).toBe(IMAGE_CUTOUT_CONTOUR_SIZE_MAX);
    expect(
      buildImageCutoutRequest({ sourceAssetId: '1', targetNodeId: 'n', scene: 'product' }).contour_size,
    ).toBe(IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT);
    expect(
      buildImageCutoutRequest({ sourceAssetId: '1', targetNodeId: 'n', scene: 'human', contourSize: 1 }).contour_size,
    ).toBe(1);
    expect(
      buildImageCutoutRequest({ sourceAssetId: '1', targetNodeId: 'n', scene: 'human', contourSize: 50 }).contour_size,
    ).toBe(50);
    expect(IMAGE_CUTOUT_CONTOUR_SIZE_MIN).toBe(1);
    expect(IMAGE_CUTOUT_CONTOUR_SIZE_MAX).toBe(50);
    expect(IMAGE_CUTOUT_CONTOUR_SIZE_DEFAULT).toBe(10);
  });

  it('开关缺省归 false（布尔直传）', () => {
    const request = buildImageCutoutRequest({ sourceAssetId: '1', targetNodeId: 'n', scene: 'human' });
    expect(request.need_contour).toBe(false);
    expect(request.need_crop_background).toBe(false);
  });
});
