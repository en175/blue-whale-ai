import { describe, expect, it } from 'vitest';
import {
  SCENE_SPLIT_DEFAULT_GRANULARITY,
  SCENE_SPLIT_EDGE_ORIGIN,
  SCENE_SPLIT_ENTRY_HINT,
  SCENE_SPLIT_GRANULARITIES,
  SCENE_SPLIT_GRANULARITY_LABELS,
  SCENE_SPLIT_MAX_DURATION_SECONDS,
  SCENE_SPLIT_MISSING_ASSET_REASON,
  SCENE_SPLIT_OVER_DURATION_REASON,
  buildSceneSplitPlaceholderNode,
  sceneSplitDisplayName,
  sceneSplitErrorText,
  sceneSplitFanoutLayout,
  sceneSplitGateReason,
  sceneSplitSegmentBox,
  sceneSplitSegmentLabel,
} from './sceneSplit';
import type { SpawnBox } from './draftSpawn';
import { overlaps as draftOverlaps } from './draftSpawn';

describe('sceneSplitGateReason（场景切分门槛预检，IKH8BJ）', () => {
  it('已关联资产且时长未超限放行（assetId 字符串/数字形态均放行）', () => {
    expect(sceneSplitGateReason({ assetId: '5' })).toBeNull();
    expect(sceneSplitGateReason({ assetId: 9 })).toBeNull();
    expect(sceneSplitGateReason({ assetId: '5', duration: 3600 })).toBeNull();
  });

  it('assetId 缺失（null/undefined）置灰并悬停唯一资产原因（门槛一，优先于时长判定）', () => {
    expect(sceneSplitGateReason({})).toBe(SCENE_SPLIT_MISSING_ASSET_REASON);
    expect(sceneSplitGateReason({ assetId: null })).toBe(SCENE_SPLIT_MISSING_ASSET_REASON);
    expect(sceneSplitGateReason({})).toContain('尚未关联资产');
    // 未关联资产且超长：仍归资产原因（先资产后时长的判定顺序）
    expect(
      sceneSplitGateReason({ assetId: null, duration: 7200 + 1 }),
    ).toBe(SCENE_SPLIT_MISSING_ASSET_REASON);
  });

  it('时长超 2 小时且有时长数据置灰并悬停原因（门槛二）：恰 7200 放行、7201 置灰', () => {
    expect(SCENE_SPLIT_MAX_DURATION_SECONDS).toBe(7200);
    expect(sceneSplitGateReason({ assetId: '5', duration: 7200 })).toBeNull();
    expect(sceneSplitGateReason({ assetId: '5', duration: 7200.001 })).toBe(
      SCENE_SPLIT_OVER_DURATION_REASON,
    );
    expect(sceneSplitGateReason({ assetId: '5', duration: 9000 })).toContain('2 小时');
  });

  it('时长数据缺失（undefined/null）放行不置灰（存量视频交后端按权威数据复核）', () => {
    expect(sceneSplitGateReason({ assetId: '5' })).toBeNull();
    // 持久化快照可能带 null（JSON 形态），运行时与 undefined 同走 typeof 守卫放行
    expect(sceneSplitGateReason({ assetId: '5', duration: null as unknown as number })).toBeNull();
  });

  it('非数值时长（NaN/字符串形态缺失）不判超限放行（仅数值参与比较）', () => {
    expect(sceneSplitGateReason({ assetId: '5', duration: NaN })).toBeNull();
    expect(
      sceneSplitGateReason({ assetId: '5', duration: undefined as unknown as number }),
    ).toBeNull();
  });

  it('格式不做前置拦截：门槛只认资产与时长，无格式原因与格式常量（任务失败口径兜底）', () => {
    expect(SCENE_SPLIT_MISSING_ASSET_REASON).not.toContain('格式');
    expect(SCENE_SPLIT_OVER_DURATION_REASON).not.toContain('格式');
  });

  it('入口效果边界 hint 常量（可用态悬停文案：切分为片段卡）', () => {
    expect(SCENE_SPLIT_ENTRY_HINT).toContain('场景');
    expect(SCENE_SPLIT_ENTRY_HINT).toContain('片段');
  });
});

describe('切分粒度三档（IKH8BR，契约同源）', () => {
  it('三档枚举 = 契约 fine/standard/coarse，默认档 standard（官方推荐值 10 档）', () => {
    expect(SCENE_SPLIT_GRANULARITIES).toEqual(['fine', 'standard', 'coarse']);
    expect(SCENE_SPLIT_DEFAULT_GRANULARITY).toBe('standard');
  });

  it('三档中文标签映射（分段控件与占位卡标注共用，仅 UI 不进任务参数）', () => {
    expect(SCENE_SPLIT_GRANULARITY_LABELS).toEqual({ fine: '细', standard: '标准', coarse: '粗' });
    expect(sceneSplitDisplayName('standard')).toBe('场景切分 · 标准');
    expect(sceneSplitDisplayName('fine')).toBe('场景切分 · 细');
    expect(sceneSplitDisplayName('coarse')).toBe('场景切分 · 粗');
  });
});

describe('buildSceneSplitPlaceholderNode（IKH8BR 发送前本地建占位卡）', () => {
  const source = {
    position: { x: 400, y: 0 },
    data: { mediaType: 'video', width: 1920, height: 1080 },
  };

  it('node id 用调用方传入的本地 id（target_node_id 先于请求存在）、落位源卡右侧让开一格', () => {
    const node = buildSceneSplitPlaceholderNode({
      nodeId: 'scene-split-1',
      granularity: 'standard',
      sourceAssetId: '5',
      source,
    });
    expect(node.id).toBe('scene-split-1');
    expect(node.type).toBe('mediaNode');
    // 16:9 内容区宽 498（280×16/9）→ x = 400 + 498 + 60
    expect(node.position).toEqual({ x: 958, y: 0 });
  });

  it('生成中骨架 + 标题「场景切分」标注粒度档 + video 媒体类型（段卡家族形态）', () => {
    const node = buildSceneSplitPlaceholderNode({
      nodeId: 'scene-split-1',
      granularity: 'fine',
      sourceAssetId: '5',
      source,
    });
    expect(node.data.genStatus).toBe('generating');
    expect(node.data.progress).toBe(0);
    expect(node.data.mediaType).toBe('video');
    expect(node.data.fileName).toBe('场景切分 · 细');
    expect(node.data.src).toBe('');
  });

  it('sceneSplit 身份冻结源素材/占位卡 id/粒度（失败重试原参数原粒度；client_token 不冻结）', () => {
    const node = buildSceneSplitPlaceholderNode({
      nodeId: 'scene-split-9',
      granularity: 'coarse',
      sourceAssetId: '12',
      source,
    });
    expect(node.data.sceneSplit).toEqual({
      sourceAssetId: '12',
      lastInput: {
        source_asset_id: '12',
        target_node_id: 'scene-split-9',
        granularity: 'coarse',
      },
    });
  });

  it('来源边 origin 常量（参考推导跳过口径）', () => {
    expect(SCENE_SPLIT_EDGE_ORIGIN).toBe('scene-split');
  });
});

describe('sceneSplitErrorText（IKH8BR 任务失败文案）', () => {
  it('优先服务端 msg（1046 契约文案经顶层 msg 透传）', () => {
    expect(sceneSplitErrorText({ code: 1046, msg: '场景切分失败，请重试' })).toBe('场景切分失败，请重试');
    expect(sceneSplitErrorText({ msg: '视频超过 2 小时' })).toBe('视频超过 2 小时');
  });

  it('msg 缺失时本地兜底同文案', () => {
    expect(sceneSplitErrorText(null)).toBe('场景切分失败，请重试');
    expect(sceneSplitErrorText({ code: 1046 })).toBe('场景切分失败，请重试');
  });
});

describe('sceneSplitSegmentLabel（IKH8C1 段卡「第 N 段 起止时间」标注）', () => {
  it('常规分支 mm:ss：工单示例「第 2 段 00:15-00:46」', () => {
    expect(sceneSplitSegmentLabel(2, 15, 46)).toBe('第 2 段 00:15-00:46');
    expect(sceneSplitSegmentLabel(1, 0, 75)).toBe('第 1 段 00:00-01:15');
  });

  it('超 1 小时分支 h:mm:ss（时不补零）：起止任一越过小时界即走该格式', () => {
    expect(sceneSplitSegmentLabel(1, 3605, 3675)).toBe('第 1 段 1:00:05-1:01:15');
    expect(sceneSplitSegmentLabel(3, 3599, 3600)).toBe('第 3 段 59:59-1:00:00');
  });

  it('整片仅 1 段不特判：第 1 段、全程时间轴照常标注', () => {
    expect(sceneSplitSegmentLabel(1, 0, 3661)).toBe('第 1 段 00:00-1:01:01');
  });

  it('起止秒向下取整（防 59.6s 进位溢出成 00:60）、负值钳 0', () => {
    expect(sceneSplitSegmentLabel(1, 59.9, 119.9)).toBe('第 1 段 00:59-01:59');
    expect(sceneSplitSegmentLabel(1, -0.5, 30)).toBe('第 1 段 00:00-00:30');
  });
});

describe('sceneSplitSegmentBox（IKH8C1 段卡占位盒）', () => {
  it('视频内容区按宽高比例（16:9 → ≈497.78×280）+ 标题余量 44', () => {
    const box = sceneSplitSegmentBox({ width: 1920, height: 1080 });
    expect(box.width).toBeCloseTo(280 * 16 / 9, 6);
    expect(box.height).toBe(280 + 44);
  });

  it('宽高缺失（null/undefined）回退 280 方形内容区', () => {
    expect(sceneSplitSegmentBox({})).toEqual({ width: 280, height: 324 });
    expect(sceneSplitSegmentBox({ width: null, height: null })).toEqual({ width: 280, height: 324 });
  });
});

describe('sceneSplitFanoutLayout（IKH8C1 段卡网格扇出避让落位）', () => {
  const anchor: SpawnBox = { x: 0, y: 0, width: 498, height: 324 };
  const segmentSize = { width: 498, height: 324 };

  it('1 段不特判：单卡落在源卡右缘 + 60、与源卡垂直中心对齐', () => {
    const [p] = sceneSplitFanoutLayout({ anchor, count: 1, segmentSize, occupied: [] });
    expect(p).toEqual({ x: 558, y: 0 });
  });

  it('4 段 2×2 网格：第 0 项左上、逐行排布（列数 ceil(√4)=2）', () => {
    const positions = sceneSplitFanoutLayout({ anchor, count: 4, segmentSize, occupied: [] });
    expect(positions).toHaveLength(4);
    const gap = 24;
    const stepX = 498 + gap;
    const stepY = 324 + gap;
    // 网格高 2 行 = 672，垂直中心对齐 anchor 中心 162 → baseY = 162 - 336 = -174
    expect(positions[0]).toEqual({ x: 558, y: -174 });
    expect(positions[1]).toEqual({ x: 558 + stepX, y: -174 });
    expect(positions[2]).toEqual({ x: 558, y: -174 + stepY });
    expect(positions[3]).toEqual({ x: 558 + stepX, y: -174 + stepY });
  });

  it('5 段 ceil(√5)=3 列 × 2 行（尾行 2 张）、9 段 3×3，N 无上限输出 N 个位置', () => {
    expect(sceneSplitFanoutLayout({ anchor, count: 5, segmentSize, occupied: [] })).toHaveLength(5);
    expect(sceneSplitFanoutLayout({ anchor, count: 9, segmentSize, occupied: [] })).toHaveLength(9);
    expect(sceneSplitFanoutLayout({ anchor, count: 23, segmentSize, occupied: [] })).toHaveLength(23);
  });

  it('自动避让：既有节点压住理想位时网格整体平移到首个无重叠位（保持源卡右侧）', () => {
    const gap = 24;
    const stepY = 324 + gap;
    // 理想位（x=558, y=-174）被一张既有卡占据 → 网格向下平移（y 逐格扫描）
    const blocker: SpawnBox = { x: 558, y: -174, width: 498, height: 324 };
    const [p] = sceneSplitFanoutLayout({ anchor, count: 1, segmentSize, occupied: [blocker] });
    expect(p!.x).toBe(558); // 仍在源卡右侧
    const moved = { x: p!.x, y: p!.y, width: 498, height: 324 };
    expect(draftOverlaps(moved, blocker)).toBe(false);
    // 平移量是 stepY 的整数倍（逐格扫描，不错乱跳位）
    expect(Math.abs(p!.y - -174) / stepY).toBeGreaterThanOrEqual(1);
  });

  it('不重叠不变式：任意 N 与既有节点，输出彼此不重叠且避开 occupied（含源卡自身排除由调用方负责）', () => {
    const occupied: SpawnBox[] = [
      { x: 400, y: 0, width: 498, height: 324 }, // 源卡附近
      { x: 558, y: -400, width: 498, height: 324 },
      { x: 1100, y: -200, width: 498, height: 324 },
    ];
    const positions = sceneSplitFanoutLayout({ anchor, count: 6, segmentSize, occupied });
    const boxes: SpawnBox[] = positions.map((p) => ({ x: p.x, y: p.y, width: 498, height: 324 }));
    for (const b of boxes) {
      for (const o of occupied) expect(draftOverlaps(b, o)).toBe(false);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(draftOverlaps(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });
});
