import { describe, expect, it } from 'vitest';
import { anchoredOverlayStyle, computeFollowAnchorAbove, enabledVideoFollowModes, firstEnabledVideoMode } from './followDialog';
import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';

/* IKFC1T 文生视频门控：判定输入为「实际成为当前目标参考」的媒体集合
   （连线 + 角色库 material + 到节点选择暂存合并后的 VideoMediaRefs）——
   无媒体 → prompt 可选且 all 保持可选（不自动切回）；有任一媒体 → prompt 不可选；
   图片数 ≥1 开图生视频、≥2 开首尾帧（帧按图片计）；invalid 不计入。 */

const ref = (id: string, mediaType: 'image' | 'video' | 'audio' = 'image', materialId?: string): VideoMediaRef => ({
  nodeId: id,
  url: `http://x/${id}`,
  name: id,
  assetId: id,
  mediaType,
  materialId,
});

const refsOf = (reference: VideoMediaRef[], frames?: { first?: VideoMediaRef; last?: VideoMediaRef }): VideoMediaRefs => ({
  reference,
  ...(frames?.first ? { first: frames.first } : {}),
  ...(frames?.last ? { last: frames.last } : {}),
});

describe('IKFC1T enabledVideoFollowModes（媒体参考集合口径）', () => {
  it('无任何媒体参考：文生视频与全能参考均可选（全能参考保持可选保证不自动切回）', () => {
    expect(enabledVideoFollowModes(refsOf([]))).toEqual(['prompt', 'all']);
  });

  it('仅文本附件（不属于媒体参考）：同无媒体判定', () => {
    // 文本附件由 textAttachmentsOf 单独推导，不在 VideoMediaRefs 内——口径上不参与门控
    expect(enabledVideoFollowModes(refsOf([]))).toEqual(['prompt', 'all']);
  });

  it('单个图片普通参考：文生视频不可选，图生视频可选', () => {
    expect(enabledVideoFollowModes(refsOf([ref('m1')]))).toEqual(['all', 'text2video']);
  });

  it('两个图片普通参考：首尾帧可选', () => {
    expect(enabledVideoFollowModes(refsOf([ref('m1'), ref('m2')]))).toEqual(['all', 'text2video', 'keyframe']);
  });

  it('视频或音频参考：文生视频与图生视频均不可选，仅全能参考', () => {
    expect(enabledVideoFollowModes(refsOf([ref('v1', 'video')]))).toEqual(['all']);
    expect(enabledVideoFollowModes(refsOf([ref('a1', 'audio')]))).toEqual(['all']);
  });

  it('首尾帧按图片计入，且已存在帧槽时 keyframe 恒可选（IKFJJT：去掉一帧不把模式踢走）', () => {
    // 存在首帧槽即保留 keyframe 可选（旧行为仅双帧可选，去掉一帧会被自动切走）
    expect(enabledVideoFollowModes(refsOf([], { first: ref('f1') }))).toEqual(['all', 'text2video', 'keyframe']);
    expect(
      enabledVideoFollowModes(refsOf([], { first: ref('f1'), last: ref('f2') })),
    ).toEqual(['all', 'text2video', 'keyframe']);
  });

  it('角色库 material 参考与连线参考同口径（图片 material 开图生视频，视频 material 仅全能参考）', () => {
    expect(
      enabledVideoFollowModes(refsOf([ref('asset-1', 'image', 'asset-1')])),
    ).toEqual(['all', 'text2video']);
    expect(
      enabledVideoFollowModes(refsOf([ref('asset-2', 'video', 'asset-2')])),
    ).toEqual(['all']);
  });

  it('失效参考不计入：invalid 项不触发门控变化', () => {
    const withInvalid: VideoMediaRefs = {
      reference: [],
      invalid: [{ nodeId: 'm1', name: 'm1', role: 'reference', reason: '生成失败的卡片不能作为参考' }],
    };
    expect(enabledVideoFollowModes(withInvalid)).toEqual(['prompt', 'all']);
  });
});

describe('firstEnabledVideoMode 兜底顺序', () => {
  it('按 prompt → all → text2video → keyframe 取首个可用；空集兜底 prompt', () => {
    expect(firstEnabledVideoMode(['all'])).toBe('all');
    expect(firstEnabledVideoMode(['prompt', 'all'])).toBe('prompt');
    expect(firstEnabledVideoMode([])).toBe('prompt');
  });
});

/* IKGYYD 卡片上方居中锚定：left 是工具栏中心点屏幕 x（组件 translateX(-50%) 真居中，
   估半宽只用于水平视口钳制，不参与居中——工具条宽度随按钮显隐动态变化，估宽居中会跳位）；
   top 是工具栏顶边屏幕 y（卡片顶边 - lift），垂直仅钳顶部 8px 保底（卡片拖到视口上方时
   不被 canvasWrapper overflow:hidden 裁掉）；zoom 只参与位置换算，lift/半宽恒屏幕像素。 */

describe('IKGYYD computeFollowAnchorAbove（卡片上方居中锚定）', () => {
  const base = {
    nodeX: 100,
    nodeY: 200,
    nodeWidth: 400,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerWidth: 1200,
    toolbarHalfWidth: 200,
    toolbarLift: 52,
  };

  it('默认场景：left 为节点中心点屏幕 x（不钳制），top 为卡片顶边上方抬升量', () => {
    expect(computeFollowAnchorAbove(base)).toEqual({ left: 300, top: 148 });
  });

  it('zoom 与视口平移参与位置换算：中心与顶边按同一变换走', () => {
    expect(computeFollowAnchorAbove({ ...base, viewport: { x: 50, y: 30, zoom: 2 } })).toEqual({
      left: (100 + 400 / 2) * 2 + 50,
      top: 200 * 2 + 30 - 52,
    });
  });

  it('缩放不影响尺寸：lift 与半宽是屏幕像素常量，缩小画布时不随 zoom 缩小', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeX: 500, viewport: { x: 0, y: 0, zoom: 0.5 } })).toEqual({
      left: (500 + 400 / 2) * 0.5,
      top: 200 * 0.5 - 52,
    });
  });

  it('水平左钳：节点中心越出左侧时 left 钳到 FOLLOW_PAD + 半宽', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeX: -600 })).toEqual({ left: 12 + 200, top: 148 });
  });

  it('水平右钳：节点中心越出右侧时 left 钳到 containerWidth - 半宽 - FOLLOW_PAD', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeX: 1000 })).toEqual({ left: 1200 - 200 - 12, top: 148 });
  });

  it('容器窄于钳制区间时左界优先（防负区间，口径同 computeFollowAnchor）', () => {
    expect(computeFollowAnchorAbove({ ...base, containerWidth: 300 })).toEqual({ left: 212, top: 148 });
  });

  it('垂直钳顶：卡片顶到视口上方时 top 不小于 8（不被容器裁掉）', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeY: -200 }).top).toBe(8);
    expect(computeFollowAnchorAbove({ ...base, nodeY: 0, toolbarLift: 100 }).top).toBe(8);
  });

  it('垂直向下不钳制：卡片在视口中下部时 top 按公式原样输出', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeY: 900 }).top).toBe(900 - 52);
  });

  it('结果四舍五入为整数（非整数 zoom/平移换算）', () => {
    expect(computeFollowAnchorAbove({ ...base, viewport: { x: 13.7, y: 0.4, zoom: 1.1 } })).toEqual({
      left: Math.round((100 + 200) * 1.1 + 13.7),
      top: Math.round(200 * 1.1 + 0.4 - 52),
    });
  });

  it('缺省估半宽为 341（IKHK7N+IKHLKR：高清 ▾ 实测 564px 与智能抠像 ▾ 约 106px 并存，估约 670px，真实半宽约 335）', () => {
    const { toolbarHalfWidth: _omit, ...noHalfWidth } = base;
    // 节点中心贴近左缘，验证缺省钳制按 341 而非 IKHLKR 的 288（双下拉并存工具条贴屏幕边缘不被裁）
    expect(computeFollowAnchorAbove({ ...noHalfWidth, nodeX: -600 })).toEqual({ left: 12 + 341, top: 148 });
    expect(computeFollowAnchorAbove({ ...noHalfWidth, nodeX: 1000 })).toEqual({ left: 1200 - 341 - 12, top: 148 });
  });
});

/* IKJR9J 锚定浮层根样式统一入口：定位与拖拽隐藏（visibility 级，组件不卸载、布局不改）合并
   到同一个 style 对象——隐藏期保留草稿/焦点，落定取消隐藏即在新锚点重现，无过渡动画。 */

describe('IKJR9J anchoredOverlayStyle（锚定浮层根样式）', () => {
  const anchor = { left: 120, top: 340 };

  it('无锚点且不隐藏：返回 undefined（沿用原行为，不落 style 对象）', () => {
    expect(anchoredOverlayStyle(null)).toBeUndefined();
    expect(anchoredOverlayStyle(null, false)).toBeUndefined();
  });

  it('有锚点不隐藏：仅定位，不带 visibility', () => {
    expect(anchoredOverlayStyle(anchor)).toEqual({ left: 120, top: 340 });
    expect(anchoredOverlayStyle(anchor, false)).toEqual({ left: 120, top: 340 });
  });

  it('有锚点且拖拽隐藏：定位保留 + visibility:hidden（不卸载、不改布局）', () => {
    expect(anchoredOverlayStyle(anchor, true)).toEqual({ left: 120, top: 340, visibility: 'hidden' });
  });

  it('无锚点但拖拽隐藏：仍输出 visibility:hidden（锚点暂缺时不错过隐藏帧）', () => {
    expect(anchoredOverlayStyle(null, true)).toEqual({ visibility: 'hidden' });
  });
});
