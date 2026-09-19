import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  canAddRefRole,
  checkAddVideoRef,
  incomingVideoRefOccupied,
  isVideoDraftNode,
  mergeVideoMaterialRefs,
  readDraftMaterialRefs,
  readRefRole,
  videoMediaRefsOf,
  videoRefConflict,
  videoRefSourceError,
} from './videoMediaRefs';

/* IKDMQS 视频参考角色连线：角色随 edge.data.refRole 持久化，
   首帧/尾帧显式指定不按连入顺序猜测；推导同源保证 Dock 显示 = 提交输入。 */

function mediaNode(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data };
}

const readyImage = (id: string, assetId = `a-${id}`, extra: Record<string, unknown> = {}) =>
  mediaNode(id, { src: `http://img/${id}.png`, mediaType: 'image', fileName: `图${id}`, assetId, ...extra });

const readyVideo = (id: string, assetId = `a-${id}`) =>
  mediaNode(id, { src: `http://vid/${id}.mp4`, mediaType: 'video', fileName: `视频${id}`, assetId });

const edge = (id: string, source: string, target: string, refRole?: string): Edge =>
  ({ id, source, target, ...(refRole ? { data: { refRole } } : {}) }) as Edge;

const allCaps = { firstFrame: true, lastFrame: true, firstLastFrame: true, referenceImage: true };

describe('isVideoDraftNode 视频草稿身份判定', () => {
  it('draft 标记 + 视频媒体类型才算视频草稿目标', () => {
    expect(isVideoDraftNode(mediaNode('d1', { draft: true, mediaType: 'video', genStatus: 'draft' }))).toBe(true);
    expect(isVideoDraftNode(mediaNode('d2', { draft: true, mediaType: 'video', genStatus: 'failed' }))).toBe(true);
    expect(isVideoDraftNode(mediaNode('m1', { mediaType: 'video' }))).toBe(false);
    expect(isVideoDraftNode(mediaNode('i1', { draft: true, mediaType: 'image' }))).toBe(false);
    expect(isVideoDraftNode(undefined)).toBe(false);
  });
});

describe('readRefRole 连线角色归一', () => {
  it('缺省与非法值归一为普通参考；显式 first/last 保留', () => {
    expect(readRefRole(edge('e1', 's', 't'))).toBe('reference');
    expect(readRefRole(edge('e2', 's', 't', 'first'))).toBe('first');
    expect(readRefRole(edge('e3', 's', 't', 'last'))).toBe('last');
    expect(readRefRole(edge('e4', 's', 't', 'whatever'))).toBe('reference');
  });
});

describe('videoRefSourceError 来源有效性校验', () => {
  it('就绪图片/视频节点可作普通参考；首尾帧仅接受图片', () => {
    expect(videoRefSourceError(readyImage('m1'), 'reference')).toBeNull();
    expect(videoRefSourceError(readyVideo('v1'), 'reference')).toBeNull();
    expect(videoRefSourceError(readyImage('m1'), 'first')).toBeNull();
    expect(videoRefSourceError(readyImage('m1'), 'last')).toBeNull();
    expect(videoRefSourceError(readyVideo('v1'), 'first')).toBe('首尾帧仅支持图片素材');
    expect(videoRefSourceError(readyVideo('v1'), 'last')).toBe('首尾帧仅支持图片素材');
  });

  it('有效性口径与图片参考一致（草稿/生成中/失败/失效/上传中/无资产）', () => {
    expect(videoRefSourceError(readyImage('d', 'a', { genStatus: 'draft', draft: true, src: '', assetId: undefined }), 'reference')).toBe('待生成的草稿不能作为参考');
    expect(videoRefSourceError(readyImage('g', 'a', { genStatus: 'generating', src: '', assetId: undefined }), 'reference')).toBe('生成中的卡片不能作为参考');
    expect(videoRefSourceError(readyImage('f', 'a', { genStatus: 'failed', src: '', assetId: undefined }), 'reference')).toBe('生成失败的卡片不能作为参考');
    expect(videoRefSourceError(readyImage('m', 'a', { assetMissing: true, src: '' }), 'reference')).toBe('素材已被删除');
    expect(videoRefSourceError(readyImage('b', 'a', { src: 'blob:pending' }), 'reference')).toBe('素材上传中，请稍候再选择');
    expect(videoRefSourceError(mediaNode('n', { src: 'http://img/n.png', mediaType: 'image' }), 'reference')).toBe('素材未关联资产，无法作为参考');
    expect(videoRefSourceError(undefined, 'reference')).toBe('素材不存在');
  });
});

describe('videoMediaRefsOf 连线推导分组参考', () => {
  const nodes = [
    readyImage('m1', 'a1'),
    readyImage('m2', 'a2'),
    readyImage('f1', 'a3'),
    readyImage('f2', 'a4'),
    readyVideo('v1', 'a5'),
    readyImage('gone', 'a9', { assetMissing: true, src: '' }),
  ];

  it('按 edge.data.refRole 分组：普通参考保序、首帧/尾帧各取一项；缺省角色为普通参考', () => {
    const edges = [
      edge('e1', 'm1', 'd1'),
      edge('e2', 'f1', 'd1', 'first'),
      edge('e3', 'm2', 'd1'),
      edge('e4', 'f2', 'd1', 'last'),
      edge('e5', 'gone', 'd1'),
      edge('e6', 'missing', 'd1'),
      edge('e7', 'm1', 'other'),
    ];
    expect(videoMediaRefsOf('d1', edges, nodes)).toEqual({
      reference: [
        { nodeId: 'm1', url: 'http://img/m1.png', name: '图m1', assetId: 'a1', mediaType: 'image' },
        { nodeId: 'm2', url: 'http://img/m2.png', name: '图m2', assetId: 'a2', mediaType: 'image' },
      ],
      invalid: [{ nodeId: 'gone', name: '图gone', role: 'reference', reason: '素材已被删除' }],
      first: { nodeId: 'f1', url: 'http://img/f1.png', name: '图f1', assetId: 'a3', mediaType: 'image' },
      last: { nodeId: 'f2', url: 'http://img/f2.png', name: '图f2', assetId: 'a4', mediaType: 'image' },
    });
  });

  it('视频来源进普通参考；同素材跨角色只取首条；同槽多帧防御性取首条', () => {
    const edges = [
      edge('e1', 'v1', 'd1'),
      edge('e2', 'm1', 'd1', 'first'),
      edge('e3', 'm1', 'd1', 'reference'),
      edge('e4', 'f1', 'd1', 'first'),
    ];
    expect(videoMediaRefsOf('d1', edges, nodes)).toEqual({
      reference: [
        { nodeId: 'v1', url: 'http://vid/v1.mp4', name: '视频v1', assetId: 'a5', mediaType: 'video' },
      ],
      first: { nodeId: 'm1', url: 'http://img/m1.png', name: '图m1', assetId: 'a1', mediaType: 'image' },
    });
  });

  it('尾帧角色连了视频来源时保留失效原因，不消费且阻止发送', () => {
    const edges = [
      edge('e1', 'm1', 'd1', 'first'),
      edge('e2', 'v1', 'd1', 'last'),
    ];
    expect(videoMediaRefsOf('d1', edges, nodes)).toEqual({
      invalid: [{ nodeId: 'v1', name: '视频v1', role: 'last', reason: '首尾帧仅支持图片素材' }],
      reference: [],
      first: { nodeId: 'm1', url: 'http://img/m1.png', name: '图m1', assetId: 'a1', mediaType: 'image' },
    });
  });

  it('来源节点回填的正数时长随参考携带（IKFCKQ 音频缩略图预览）；缺失或非法不携带', () => {
    const withDuration = [
      readyImage('m1', 'a1', { duration: 95 }),
      readyImage('bad1', 'a6', { duration: 0 }),
      readyImage('bad2', 'a7', { duration: 'x' }),
    ];
    const edges = [edge('e1', 'm1', 'd1'), edge('e2', 'bad1', 'd1'), edge('e3', 'bad2', 'd1')];
    const refs = videoMediaRefsOf('d1', edges, withDuration);
    expect(refs.reference[0]).toMatchObject({ nodeId: 'm1', duration: 95 });
    expect(refs.reference[1]).toMatchObject({ nodeId: 'bad1' });
    expect(refs.reference[1]!.duration).toBeUndefined();
    expect(refs.reference[2]!.duration).toBeUndefined();
  });

  it('TC_DG_205：数字资产与人像库 Asset- 前缀（相同 materialId）只保留首条', () => {
    const nodes = [
      readyImage('lib', 'Asset-image-1', { materialId: 'Asset-image-1' }),
      readyImage('proj', '88421', { materialId: 'Asset-image-1' }),
    ];
    const edges = [edge('e1', 'lib', 'd1'), edge('e2', 'proj', 'd1')];
    expect(videoMediaRefsOf('d1', edges, nodes).reference).toEqual([
      { nodeId: 'lib', url: 'http://img/lib.png', name: '图lib', assetId: 'Asset-image-1', mediaType: 'image', materialId: 'Asset-image-1' },
    ]);
  });
});

describe('readDraftMaterialRefs 角色库草稿参考解析（IKFC1T 修复防回归）', () => {
  it('合法项完整解析；断言写法回归（raw 取到 data 整体）会在此暴露', () => {
    const node = mediaNode('d1', {
      draftMaterialRefs: [
        { materialId: 'asset-1', url: 'http://img/1.png', name: '角色立绘', mediaType: 'image', role: 'reference' },
        { materialId: 'asset-2', url: 'http://img/2.png', mediaType: 'video', role: 'first' },
      ],
    });
    expect(readDraftMaterialRefs(node)).toEqual([
      { materialId: 'asset-1', url: 'http://img/1.png', name: '角色立绘', mediaType: 'image', role: 'reference' },
      { materialId: 'asset-2', url: 'http://img/2.png', name: 'asset-2', mediaType: 'video', role: 'first' },
    ]);
  });

  it('字段缺失/形态非法逐项跳过；无字段返回空数组', () => {
    expect(readDraftMaterialRefs(undefined)).toEqual([]);
    expect(readDraftMaterialRefs(mediaNode('d1', {}))).toEqual([]);
    expect(readDraftMaterialRefs(mediaNode('d1', { draftMaterialRefs: 'not-array' }))).toEqual([]);
    expect(readDraftMaterialRefs(mediaNode('d1', {
      draftMaterialRefs: [
        { url: 'http://img/x.png', mediaType: 'image', role: 'reference' }, // 缺 materialId
        { materialId: 'asset-3', mediaType: 'audio', role: 'reference' },   // 非法类型
        { materialId: 'asset-4', url: 'http://img/4.png', mediaType: 'image', role: 'hero' }, // 非法角色
      ],
    }))).toEqual([]);
  });
});

describe('videoRefConflict 组合校验（与服务端 400 同口径 + 能力位）', () => {
  const ref = (id: string, assetId = `a-${id}`): import('./videoMediaRefs').VideoMediaRef => ({
    nodeId: id, url: `http://img/${id}.png`, name: id, assetId, mediaType: 'image',
  });

  it('空输入与合法组合（纯参考 / 完整首尾帧）不阻止', () => {
    expect(videoRefConflict({ reference: [] }, allCaps)).toBeNull();
    expect(videoRefConflict({ reference: [ref('m1')] }, allCaps)).toBeNull();
    expect(videoRefConflict({ reference: [], first: ref('f1'), last: ref('f2') }, allCaps)).toBeNull();
  });

  it('首尾帧缺项或与普通参考混用时被阻止并给出原因', () => {
    expect(videoRefConflict({ reference: [], last: ref('f2') }, allCaps)).toBe('请补充首帧');
    expect(videoRefConflict({ reference: [], first: ref('f1') }, allCaps)).toBe('请补充尾帧');
    expect(videoRefConflict({ reference: [ref('m1')], first: ref('f1') }, allCaps)).toBe('首尾帧与普通参考不能混用，请移除其中一类输入');
    expect(videoRefConflict({ reference: [ref('m1')], first: ref('f1'), last: ref('f2') }, allCaps)).toBe('首尾帧与普通参考不能混用，请移除其中一类输入');
  });

  it('首尾帧不按不可靠能力位拦截，普通参考仍校验能力', () => {
    expect(videoRefConflict({ reference: [], first: ref('f1'), last: ref('f2') }, { ...allCaps, firstLastFrame: false })).toBeNull();
    expect(videoRefConflict({ reference: [], first: ref('f1'), last: ref('f2') }, { ...allCaps, firstFrame: false })).toBeNull();
    expect(videoRefConflict({ reference: [], first: ref('f1'), last: ref('f2') }, { ...allCaps, lastFrame: false })).toBeNull();
    expect(videoRefConflict({ reference: [ref('m1')] }, { ...allCaps, referenceImage: false })).toBe('当前模型不支持图片参考，请移除普通参考');
  });
});

describe('canAddRefRole 角色槽可用性', () => {
  const ref = (id: string): import('./videoMediaRefs').VideoMediaRef => ({
    nodeId: id, url: `http://img/${id}.png`, name: id, assetId: `a-${id}`, mediaType: 'image',
  });

  it('首帧槽：能力支持且空闲才可加', () => {
    expect(canAddRefRole('first', { reference: [] }, allCaps)).toBe(true);
    expect(canAddRefRole('first', { reference: [], first: ref('f1') }, allCaps)).toBe(false);
    expect(canAddRefRole('first', { reference: [] }, { ...allCaps, firstFrame: false })).toBe(false);
  });

  it('尾帧槽：能力支持且空闲即可添加，不要求先添加首帧', () => {
    expect(canAddRefRole('last', { reference: [] }, allCaps)).toBe(true);
    expect(canAddRefRole('last', { reference: [], first: ref('f1') }, allCaps)).toBe(true);
    expect(canAddRefRole('last', { reference: [], first: ref('f1'), last: ref('f2') }, allCaps)).toBe(false);
    // 添加阶段独立占槽；提交时再要求首尾帧齐全。
    expect(canAddRefRole('last', { reference: [], first: ref('f1') }, { ...allCaps, firstLastFrame: false })).toBe(true);
    expect(canAddRefRole('last', { reference: [], first: ref('f1') }, { ...allCaps, lastFrame: false })).toBe(false);
  });

  it('普通参考槽：仅取决于参考图能力位', () => {
    expect(canAddRefRole('reference', { reference: [] }, allCaps)).toBe(true);
    expect(canAddRefRole('reference', { reference: [] }, { ...allCaps, referenceImage: false })).toBe(false);
  });
});

describe('TC_DG_205 视频参考跨 ID 空间去重', () => {
  const libraryRef: import('./videoMediaRefs').VideoMediaRef = {
    nodeId: 'Asset-image-1',
    url: 'http://img/same.png',
    name: '角色立绘',
    assetId: 'Asset-image-1',
    mediaType: 'image',
    materialId: 'Asset-image-1',
  };
  const projectRef: import('./videoMediaRefs').VideoMediaRef = {
    nodeId: 'n-proj',
    url: 'http://img/same.png',
    name: '资产副本',
    assetId: '88421',
    mediaType: 'image',
    materialId: 'Asset-image-1',
  };

  it('人像库 ID 与带同一 materialId 的项目资产互相占槽', () => {
    expect(incomingVideoRefOccupied({ reference: [libraryRef] }, ['88421', 'Asset-image-1'])).toBe(true);
    expect(incomingVideoRefOccupied({ reference: [projectRef] }, ['Asset-image-1'])).toBe(true);
    expect(incomingVideoRefOccupied({ reference: [libraryRef] }, ['88422'])).toBe(false);
  });

  it('checkAddVideoRef 跨空间重复按普通参考跳过', () => {
    expect(checkAddVideoRef('reference', 'image', '88421', { reference: [libraryRef] }, null, ['Asset-image-1']))
      .toBe('重复的素材已跳过');
    expect(checkAddVideoRef('reference', 'image', 'Asset-image-1', { reference: [projectRef] }))
      .toBe('重复的素材已跳过');
  });

  it('mergeVideoMaterialRefs 不把已在边推导中的同一 material 再追加', () => {
    const merged = mergeVideoMaterialRefs(
      { reference: [projectRef] },
      [{ materialId: 'Asset-image-1', url: libraryRef.url, name: libraryRef.name, mediaType: 'image', role: 'reference' }],
    );
    expect(merged.reference).toEqual([projectRef]);
  });
});
