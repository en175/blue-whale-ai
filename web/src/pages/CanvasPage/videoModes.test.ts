import { describe, expect, it } from 'vitest';
import {
  configuredVideoModes,
  effectiveVideoParams,
  lockedDurationOf,
  lockedRatioOf,
  normalizeVideoMode,
} from '@/utils/video-modes';
import {
  defaultVideoModeFor,
  enabledVideoModes,
  hasVideoReference,
  normalizeStoredVideoMode,
  nextVideoModeOnRefsChange,
  resolveVideoMode,
  videoModeAfterRefAdd,
  videoModeAcceptsRef,
  videoModeRefsSignature,
} from './videoModes';
import {
  EDIT_MODE_VIDEO_REFERENCE_MAX,
  videoReferenceMaxForMode,
} from '@/utils/model-reference-limits';
import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';

const ref = (
  id: string,
  mediaType: 'image' | 'video' | 'audio' = 'image',
  materialId?: string,
): VideoMediaRef => ({
  nodeId: id,
  url: `http://x/${id}`,
  name: id,
  assetId: id,
  mediaType,
  materialId,
});

const refsOf = (
  reference: VideoMediaRef[],
  frames?: { first?: VideoMediaRef; last?: VideoMediaRef },
): VideoMediaRefs => ({
  reference,
  ...(frames?.first ? { first: frames.first } : {}),
  ...(frames?.last ? { last: frames.last } : {}),
});

const MODES_25 = [
  'text2video',
  'omni',
  'image_reference',
  'first_frame',
  'first_last_frame',
  'edit',
  'extend',
] as const;

const MODES_20 = ['text2video', 'omni', 'image_reference', 'first_frame', 'first_last_frame'] as const;

describe('ADR-0124 视频模式词表与配置读取', () => {
  it('normalizeVideoMode：新模式原样通过，旧画布键与后端旧别名映射到新键', () => {
    for (const mode of MODES_25) expect(normalizeVideoMode(mode)).toBe(mode);
    expect(normalizeVideoMode('prompt')).toBe('text2video');
    expect(normalizeVideoMode('all')).toBe('omni');
    expect(normalizeVideoMode('keyframe')).toBe('first_last_frame');
    expect(normalizeVideoMode('default')).toBe('text2video');
    expect(normalizeVideoMode('prolong')).toBe('extend');
  });

  it('normalizeVideoMode：未知值与非字符串返回 null', () => {
    expect(normalizeVideoMode('firstlast')).toBeNull();
    expect(normalizeVideoMode('')).toBeNull();
    expect(normalizeVideoMode(undefined)).toBeNull();
    expect(normalizeVideoMode(3)).toBeNull();
  });

  it('configuredVideoModes：键集即白名单，按固定顺序返回', () => {
    expect(configuredVideoModes({ task_types: { omni: {}, text2video: {} } })).toEqual([
      'text2video',
      'omni',
    ]);
    expect(
      configuredVideoModes({
        task_types: {
          extend: {},
          first_last_frame: {},
          text2video: {},
          omni: {},
          image_reference: {},
          first_frame: {},
          edit: {},
        },
      }),
    ).toEqual([...MODES_25]);
  });

  it('configuredVideoModes：空对象/缺失/非法形态一律空表（不兜底）', () => {
    expect(configuredVideoModes({ task_types: {} })).toEqual([]);
    expect(configuredVideoModes({ task_types: null })).toEqual([]);
    expect(configuredVideoModes({})).toEqual([]);
    expect(configuredVideoModes(null)).toEqual([]);
    expect(configuredVideoModes(undefined)).toEqual([]);
    expect(configuredVideoModes({ task_types: 'oops' as unknown as Record<string, unknown> })).toEqual([]);
  });

  it('configuredVideoModes：白名单外的未知键被忽略', () => {
    expect(configuredVideoModes({ task_types: { nothing: {}, photo2video: {} } })).toEqual([]);
  });
});

describe('ADR-0124 门控（配置 ∩ 素材）enabledVideoModes', () => {
  it('无媒体：文生视频与两个帧模式可选（帧槽由帧模式自己产出），其余素材型模式不可选', () => {
    expect(enabledVideoModes(refsOf([]), MODES_25)).toEqual([
      'text2video',
      'omni',
      'first_frame',
      'first_last_frame',
    ]);
  });

  it('只有图片：文生视频不可选，图片参考与两个帧模式可选', () => {
    expect(enabledVideoModes(refsOf([ref('m1')]), MODES_25)).toEqual([
      'omni',
      'image_reference',
      'first_frame',
      'first_last_frame',
    ]);
  });

  it('两张图片：图片参考与两个帧模式可选（张数越界在切换那一刻拦）', () => {
    expect(enabledVideoModes(refsOf([ref('m1'), ref('m2')]), MODES_25)).toEqual([
      'omni',
      'image_reference',
      'first_frame',
      'first_last_frame',
    ]);
  });

  it('只有视频：图片类与帧类不可选，全能参考与编辑/延长可选', () => {
    expect(enabledVideoModes(refsOf([ref('v1', 'video')]), MODES_25)).toEqual([
      'omni',
      'edit',
      'extend',
    ]);
  });

  it('视频 + 图片：编辑/延长仍可选（官方允许编辑任务带参考图）', () => {
    expect(enabledVideoModes(refsOf([ref('v1', 'video'), ref('m1')]), MODES_25)).toEqual([
      'omni',
      'edit',
      'extend',
    ]);
  });

  it('2 段视频：编辑/延长不可选（只允许 1 段），只剩全能参考', () => {
    expect(enabledVideoModes(refsOf([ref('v1', 'video'), ref('v2', 'video')]), MODES_25)).toEqual([
      'omni',
    ]);
    expect(
      enabledVideoModes(refsOf([ref('v1', 'video'), ref('v2', 'video'), ref('m1')]), MODES_25),
    ).toEqual(['omni']);
  });

  it('只有音频：仅全能参考可选（音频不参与图片/帧/编辑判定）', () => {
    expect(enabledVideoModes(refsOf([ref('a1', 'audio')]), MODES_25)).toEqual(['omni']);
  });

  it('帧槽占位：帧模式恒可选（去掉一帧不把模式踢走）', () => {
    expect(enabledVideoModes(refsOf([], { first: ref('f1') }), MODES_25)).toEqual([
      'omni',
      'image_reference',
      'first_frame',
      'first_last_frame',
    ]);
    expect(
      enabledVideoModes(refsOf([], { first: ref('f1'), last: ref('f2') }), MODES_25),
    ).toEqual(['omni', 'image_reference', 'first_frame', 'first_last_frame']);
  });

  it('白名单为空：不渲染任何模式', () => {
    expect(enabledVideoModes(refsOf([ref('m1')]), [])).toEqual([]);
  });

  it('2.0 白名单：没有 edit/extend，只有视频时编辑/延长不出现', () => {
    expect(enabledVideoModes(refsOf([ref('v1', 'video')]), MODES_20)).toEqual(['omni']);
  });

  it('视频/音频参考在场：两个帧模式都不可选（帧槽只收图片）', () => {
    for (const mode of ['first_frame', 'first_last_frame'] as const) {
      expect(enabledVideoModes(refsOf([ref('v1', 'video')]), [mode])).toEqual([]);
      expect(enabledVideoModes(refsOf([ref('a1', 'audio')]), [mode])).toEqual([]);
    }
  });

  it('失效参考不计入：invalid 项不改变门控', () => {
    const withInvalid: VideoMediaRefs = {
      reference: [],
      invalid: [{ nodeId: 'm1', name: 'm1', role: 'reference', reason: '生成失败的卡片不能作为参考' }],
    };
    expect(enabledVideoModes(withInvalid, MODES_25)).toEqual([
      'text2video',
      'omni',
      'first_frame',
      'first_last_frame',
    ]);
  });
});

describe('ADR-0124 默认模式表 defaultVideoModeFor', () => {
  it('空素材集 → 文生视频', () => {
    expect(defaultVideoModeFor(refsOf([]))).toBe('text2video');
  });

  it('只有图片 → 图片参考', () => {
    expect(defaultVideoModeFor(refsOf([ref('m1')]))).toBe('image_reference');
    expect(defaultVideoModeFor(refsOf([ref('m1'), ref('m2')]))).toBe('image_reference');
  });

  it('只有视频 → 视频编辑', () => {
    expect(defaultVideoModeFor(refsOf([ref('v1', 'video')]))).toBe('edit');
  });

  it('1 段视频 + N 张图片 → 视频编辑（参考图片不受限）', () => {
    expect(defaultVideoModeFor(refsOf([ref('v1', 'video'), ref('m1')]))).toBe('edit');
    expect(defaultVideoModeFor(refsOf([ref('v1', 'video'), ref('m1'), ref('m2')]))).toBe('edit');
  });

  it('2 段视频 → 全能参考（编辑只允许 1 段）', () => {
    expect(defaultVideoModeFor(refsOf([ref('v1', 'video'), ref('v2', 'video')]))).toBe('omni');
    expect(defaultVideoModeFor(refsOf([ref('v1', 'video'), ref('v2', 'video'), ref('m1')]))).toBe('omni');
  });

  it('帧槽不参与默认表：只有帧槽仍是空素材集口径', () => {
    expect(defaultVideoModeFor(refsOf([], { first: ref('f1'), last: ref('f2') }))).toBe('text2video');
  });

  it('只有音频 → 全能参考（音频无专表，归全能参考）', () => {
    expect(defaultVideoModeFor(refsOf([ref('a1', 'audio')]))).toBe('omni');
  });
});

describe('ADR-0124 默认表兜底 resolveVideoMode', () => {
  it('目标在白名单内则原样返回', () => {
    expect(resolveVideoMode('image_reference', ['text2video', 'omni', 'image_reference'])).toBe(
      'image_reference',
    );
  });

  it('白名单无 edit：只有视频落回全能参考（2.0 形态）', () => {
    const enabled = enabledVideoModes(refsOf([ref('v1', 'video')]), MODES_20);
    expect(resolveVideoMode(defaultVideoModeFor(refsOf([ref('v1', 'video')])), enabled)).toBe('omni');
  });

  it('无全能参考：取白名单内第一个普通参考类模式（帧模式不作兜底）', () => {
    expect(resolveVideoMode('edit', ['text2video', 'first_last_frame'])).toBe('text2video');
    expect(resolveVideoMode('edit', ['first_last_frame', 'image_reference'])).toBe('image_reference');
  });

  it('可选集为空返回 null（不切）', () => {
    expect(resolveVideoMode('edit', [])).toBeNull();
  });
});

describe('ADR-0124 覆盖式自动切换 nextVideoModeOnRefsChange', () => {
  it('素材集变化、当前模式已收不下 → 切到默认表模式', () => {
    expect(nextVideoModeOnRefsChange('text2video', refsOf([ref('m1')]), MODES_25)).toBe(
      'image_reference',
    );
    expect(nextVideoModeOnRefsChange('image_reference', refsOf([]), MODES_25)).toBe('text2video');
  });

  it('素材集变化、当前模式仍收得下 → 不切（手选的视频编辑加参考图保持编辑）', () => {
    expect(
      nextVideoModeOnRefsChange('edit', refsOf([ref('v1', 'video'), ref('m1')]), MODES_25),
    ).toBeNull();
  });

  it('当前是编辑、加入第二段视频 → 编辑收不下，自动切全能参考', () => {
    expect(
      nextVideoModeOnRefsChange('edit', refsOf([ref('v1', 'video'), ref('v2', 'video')]), MODES_25),
    ).toBe('omni');
  });

  it('当前模式不在白名单 → 切到兜底模式', () => {
    expect(nextVideoModeOnRefsChange('edit', refsOf([ref('v1', 'video')]), MODES_20)).toBe('omni');
  });

  it('切进帧模式后普通参考被搬空：帧模式仍收得下，不把用户弹回去', () => {
    expect(
      nextVideoModeOnRefsChange('first_last_frame', refsOf([], { first: ref('f1'), last: ref('f2') }), MODES_25),
    ).toBeNull();
  });

  it('帧模式只可选不自动切：无帧槽时也保留用户所选帧模式（不被默认表顶走）', () => {
    expect(nextVideoModeOnRefsChange('first_last_frame', refsOf([]), MODES_25)).toBeNull();
    expect(nextVideoModeOnRefsChange('first_frame', refsOf([]), MODES_25)).toBeNull();
  });

  it('素材全部移除：图片参考收不下，切回文生视频（旧「不自动切回」口径已被替换）', () => {
    expect(nextVideoModeOnRefsChange('image_reference', refsOf([]), MODES_25)).toBe('text2video');
  });
});

describe('ADR-0124 素材签名 mediaSignature：角色改写不算改动', () => {
  it('普通参考搬进帧槽 / 帧槽转回普通参考：签名不变', () => {
    const ordinary = videoModeRefsSignature(refsOf([ref('m1'), ref('m2')]));
    const framed = videoModeRefsSignature(refsOf([], { first: ref('m1'), last: ref('m2') }));
    const restored = videoModeRefsSignature(refsOf([ref('m1'), ref('m2')]));
    expect(framed).toBe(ordinary);
    expect(restored).toBe(ordinary);
  });

  it('参考顺序变化不算改动，增删素材算改动', () => {
    expect(videoModeRefsSignature(refsOf([ref('m1'), ref('m2')]))).toBe(
      videoModeRefsSignature(refsOf([ref('m2'), ref('m1')])),
    );
    expect(videoModeRefsSignature(refsOf([ref('m1')]))).not.toBe(videoModeRefsSignature(refsOf([])));
  });
});

describe('ADR-0124 草稿旧值兼容 normalizeStoredVideoMode', () => {
  it('旧画布键直映射（prompt/all/keyframe）', () => {
    expect(normalizeStoredVideoMode('prompt', refsOf([]))).toBe('text2video');
    expect(normalizeStoredVideoMode('all', refsOf([ref('m1')]))).toBe('omni');
    expect(normalizeStoredVideoMode('keyframe', refsOf([], { first: ref('f1') }))).toBe(
      'first_last_frame',
    );
  });

  it('歧义键 text2video：带图无视频的旧草稿判图片参考，否则判文生视频', () => {
    expect(normalizeStoredVideoMode('text2video', refsOf([ref('m1')]))).toBe('image_reference');
    expect(normalizeStoredVideoMode('text2video', refsOf([]))).toBe('text2video');
    expect(normalizeStoredVideoMode('text2video', refsOf([ref('v1', 'video')]))).toBe('text2video');
    expect(normalizeStoredVideoMode('text2video', refsOf([ref('m1'), ref('v1', 'video')]))).toBe(
      'text2video',
    );
  });

  it('新模式值为无歧义原样恢复，未知值返回 null', () => {
    expect(normalizeStoredVideoMode('omni', refsOf([]))).toBe('omni');
    expect(normalizeStoredVideoMode('edit', refsOf([ref('v1', 'video')]))).toBe('edit');
    expect(normalizeStoredVideoMode('firstlast', refsOf([]))).toBeNull();
    expect(normalizeStoredVideoMode(undefined, refsOf([]))).toBeNull();
  });
});

describe('ADR-0124 模式接受的参考身份 videoModeAcceptsRef', () => {
  it('文生视频不接受任何参考身份', () => {
    expect(videoModeAcceptsRef('text2video', 'reference', 'image')).toBe(false);
    expect(videoModeAcceptsRef('text2video', 'first_frame', 'image')).toBe(false);
    expect(videoModeAcceptsRef('text2video', 'last_frame', 'image')).toBe(false);
  });

  it('全能参考收普通参考的三种媒体、不收帧角色', () => {
    expect(videoModeAcceptsRef('omni', 'reference', 'image')).toBe(true);
    expect(videoModeAcceptsRef('omni', 'reference', 'video')).toBe(true);
    expect(videoModeAcceptsRef('omni', 'reference', 'audio')).toBe(true);
    expect(videoModeAcceptsRef('omni', 'first_frame', 'image')).toBe(false);
  });

  it('图片参考只收普通参考里的图片', () => {
    expect(videoModeAcceptsRef('image_reference', 'reference', 'image')).toBe(true);
    expect(videoModeAcceptsRef('image_reference', 'reference', 'video')).toBe(false);
    expect(videoModeAcceptsRef('image_reference', 'reference', 'audio')).toBe(false);
    expect(videoModeAcceptsRef('image_reference', 'first_frame', 'image')).toBe(false);
  });

  it('单首帧只收首帧；首尾帧收首帧与尾帧', () => {
    expect(videoModeAcceptsRef('first_frame', 'first_frame', 'image')).toBe(true);
    expect(videoModeAcceptsRef('first_frame', 'last_frame', 'image')).toBe(false);
    expect(videoModeAcceptsRef('first_last_frame', 'first_frame', 'image')).toBe(true);
    expect(videoModeAcceptsRef('first_last_frame', 'last_frame', 'image')).toBe(true);
    expect(videoModeAcceptsRef('first_last_frame', 'reference', 'image')).toBe(false);
  });

  it('视频编辑/延长收普通参考（官方允许图/视频/音频），不收帧角色', () => {
    expect(videoModeAcceptsRef('edit', 'reference', 'video')).toBe(true);
    expect(videoModeAcceptsRef('edit', 'reference', 'image')).toBe(true);
    expect(videoModeAcceptsRef('edit', 'reference', 'audio')).toBe(true);
    expect(videoModeAcceptsRef('edit', 'first_frame', 'image')).toBe(false);
    expect(videoModeAcceptsRef('extend', 'reference', 'video')).toBe(true);
  });
});

describe('ADR-0124 编辑/延长的「至少 1 段参考视频」判定', () => {
  it('普通参考里有视频才算满足', () => {
    expect(hasVideoReference(refsOf([ref('v1', 'video')]))).toBe(true);
    expect(hasVideoReference(refsOf([ref('v1', 'video'), ref('m1')]))).toBe(true);
    expect(hasVideoReference(refsOf([ref('m1')]))).toBe(false);
    expect(hasVideoReference(refsOf([]))).toBe(false);
  });

  it('帧槽里的素材不算普通参考视频', () => {
    expect(hasVideoReference(refsOf([], { first: ref('f1') }))).toBe(false);
  });
});

describe('ADR-0124 参数锁读能力行配置', () => {
  const seed25 = {
    task_types: {
      first_frame: { allowed_ratios: ['adaptive'] },
      first_last_frame: { allowed_ratios: ['adaptive'] },
      edit: { allowed_ratios: ['adaptive'], allowed_durations: [-1] },
      extend: { allowed_ratios: ['adaptive'] },
    },
  };
  const seed20 = {
    task_types: {
      text2video: {},
      first_frame: {},
      first_last_frame: {},
    },
  };

  it('比例锁：约束声明恰一个比例时锁定，2.0 的空对象不锁', () => {
    expect(lockedRatioOf(seed25, 'edit')).toBe('adaptive');
    expect(lockedRatioOf(seed25, 'extend')).toBe('adaptive');
    expect(lockedRatioOf(seed25, 'first_last_frame')).toBe('adaptive');
    expect(lockedRatioOf(seed20, 'first_last_frame')).toBeNull();
    expect(lockedRatioOf(seed20, 'text2video')).toBeNull();
    expect(lockedRatioOf(undefined, 'edit')).toBeNull();
  });

  it('时长锁：只有 edit 声明 [-1]（跟随原视频）', () => {
    expect(lockedDurationOf(seed25, 'edit')).toBe(-1);
    expect(lockedDurationOf(seed25, 'extend')).toBeNull();
    expect(lockedDurationOf(seed20, 'edit')).toBeNull();
  });

  it('生效参数：锁定的维度取配置值，未锁定的取用户值', () => {
    expect(
      effectiveVideoParams(seed25, 'edit', { aspectRatio: '16:9', duration: 5 }),
    ).toEqual({ aspect_ratio: 'adaptive', duration: -1 });
    expect(
      effectiveVideoParams(seed25, 'extend', { aspectRatio: '16:9', duration: 5 }),
    ).toEqual({ aspect_ratio: 'adaptive', duration: 5 });
    expect(
      effectiveVideoParams(seed20, 'first_last_frame', { aspectRatio: '16:9', duration: 5 }),
    ).toEqual({ aspect_ratio: '16:9', duration: 5 });
  });
});

describe('IKL406 编辑模式视频上限收紧（与后端 videoReferenceMax 同口径）', () => {
  it('edit 收紧为 1，其余模式保持通用上限；上限为 0 时不反向放宽', () => {
    expect(EDIT_MODE_VIDEO_REFERENCE_MAX).toBe(1);
    expect(videoReferenceMaxForMode(3, 'edit')).toBe(1);
    expect(videoReferenceMaxForMode(5, 'omni')).toBe(5);
    expect(videoReferenceMaxForMode(3, null)).toBe(3);
    expect(videoReferenceMaxForMode(3, undefined)).toBe(3);
    expect(videoReferenceMaxForMode(0, 'edit')).toBe(0);
  });

  it('加入第二段视频时按切换后的全能参考算上限（不误判成编辑）', () => {
    expect(videoModeAfterRefAdd('edit', refsOf([]), 'video')).toBe('edit');
    expect(videoModeAfterRefAdd('edit', refsOf([ref('v1', 'video')]), 'video')).toBe('omni');
    expect(videoModeAfterRefAdd('edit', refsOf([ref('m1')]), 'image')).toBe('edit');
    expect(videoModeAfterRefAdd(null, refsOf([ref('v1', 'video')]), 'video')).toBe('omni');
  });
});
