// @vitest-environment jsdom
/* IKIHPK 音视频合成草稿卡会话与拖线绑定页面级链路测试：点工具条「音视频合成」从源音频卡拉出
   视频型草稿卡（默认音频输入线 + 合成身份 + 参数默认档），拖线落点按目标卡身份分流
   （落到未绑定/绑定中的合成草稿卡 → 绑定边 origin=audio-video-mux；落其他卡维持普通参考连线；
   落空白不绑定），素材库浮层单列表选中即绑定且不拉线，视频槽三态（引导/绑定中跟手/已绑定信息条：
   缩略图、文件名、时长、来源标注、× 移除重绑），固定音频输入线不可单独删而绑定线删除即解绑，
   面板参数写卡持久化、未绑定发送置灰，会话注册进第 13 种工具会话（互斥/Esc/选中规范化/点空白
   四退出 + 工具条整条不渲染模态）。
   发送的真实提交与占位回填归 IKIHP M（本票发送钮只做 UI 态：点击不建任务、不改卡态）。
   渲染沿用 testing/canvasPageTestHarness（页面级共享夹具）。 */
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import NodeFollowToolbar from './components/NodeFollowToolbar';
import {
  AUDIO_VIDEO_MUX_EDGE_ORIGIN,
  AUDIO_VIDEO_MUX_TITLE,
  AUDIO_VIDEO_MUX_UNAVAILABLE_REASON,
} from './audioVideoMux';
import {
  assetLibraryRecords,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaNodes,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

type WireState = {
  fromNode?: Node | null;
  toNode?: Node | null;
  isValid?: boolean | null;
  toHandle?: { nodeId?: string | null } | null;
};

/** 画布：音频成品卡 a1（固定源）+ 视频成品卡 v1/v2（候选）+ 可选既有合成草稿卡 m1
 *  + 可选 HD 身份草稿卡 hd1（生成面板准入用例用） */
function seedDoc(opts?: { audioUnlinked?: boolean; withMuxDraft?: boolean; withBound?: boolean; withHdDraft?: boolean }) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'a1',
      type: 'mediaNode',
      position: { x: 0, y: 0 },
      data: {
        src: 'http://aud/a1.mp3',
        mediaType: 'audio',
        fileName: '海浪环境音.mp3',
        duration: 227,
        ...(opts?.audioUnlinked ? {} : { assetId: '8' }),
      },
    },
    {
      id: 'v1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: {
        src: 'http://vid/v1.mp4',
        mediaType: 'video',
        fileName: '城市夜景.mp4',
        assetId: '5',
        width: 1280,
        height: 720,
        duration: 12,
      },
    },
    {
      id: 'v2',
      type: 'mediaNode',
      position: { x: 400, y: 400 },
      data: {
        src: 'http://vid/v2.mp4',
        mediaType: 'video',
        fileName: '产品开箱.mp4',
        assetId: '6',
        width: 1920,
        height: 1080,
        duration: 45,
      },
    },
  ];
  const edges: Array<Record<string, unknown>> = [];
  if (opts?.withMuxDraft) {
    nodes.push({
      id: 'm1',
      type: 'mediaNode',
      position: { x: 1040, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: AUDIO_VIDEO_MUX_TITLE,
        genStatus: 'draft',
        draft: true,
        audioVideoMux: {
          sourceNodeId: 'a1',
          sourceAssetId: '8',
          reserveAudio: true,
          sync: 'none',
          ...(opts?.withBound ? { video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4', duration: 12 } } : {}),
        },
      },
    });
    edges.push({ id: 'e-mux-audio', source: 'a1', target: 'm1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } });
    if (opts?.withBound) {
      edges.push({ id: 'e-mux-bind', source: 'v1', target: 'm1', data: { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN } });
    }
  }
  if (opts?.withHdDraft) {
    nodes.push({
      id: 'hd1',
      type: 'mediaNode',
      position: { x: 1400, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: 'HD',
        genStatus: 'draft',
        draft: true,
        videoEnhance: { sourceAssetId: '5' },
      },
    });
  }
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 227 },
      5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
      6: { asset_id: 6, type: 'video', access_url: 'http://vid/v2.mp4', width: 1920, height: 1080 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const muxDraftNode = () => mediaNodes().find((n) => n.id.startsWith('media-draft'));
const identityOf = (node: Node | undefined) =>
  ((node?.data ?? {}) as Record<string, unknown>).audioVideoMux as Record<string, unknown> | undefined;
const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;

const panel = () => document.body.querySelector<HTMLElement>('[data-testid="audio-video-mux-panel"]');
const slot = () => document.body.querySelector<HTMLElement>('[data-testid="audio-video-mux-slot"]');
const boundBar = () => document.body.querySelector<HTMLElement>('[data-testid="audio-video-mux-bound"]');
const sendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-video-mux-send"]');
const reserveBtn = (value: boolean) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="audio-video-mux-reserve-${value}"]`);
const syncBtn = (value: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="audio-video-mux-sync-${value}"]`);
const libraryPop = () => document.body.querySelector<HTMLElement>('[data-testid="audio-video-mux-library"]');

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 走音频卡工具条「音视频合成」（回调挂在节点 data 上，同插帧/混合先例） */
async function compose(id = 'a1') {
  const dispatch = (mediaNode(id).data as Record<string, unknown>).onComposeAudioVideo as
    | ((nodeId: string) => void)
    | undefined;
  await act(async () => {
    dispatch?.(id);
  });
}

/** 拖线：从 source 卡右侧加号拖出、松手落到 target 卡（真实手势进浏览器人工回归，
 *  本接缝直接驱动落点判定；未传 target 即落空白） */
async function dropWire(sourceId: string, targetId?: string, state?: WireState) {
  document.elementsFromPoint = () => [];
  await act(async () => {
    flowProps.current.onConnectStart(sourceId);
  });
  await act(async () => {
    flowProps.current.onConnectEnd(
      new MouseEvent('mouseup', { clientX: 0, clientY: 0 }),
      state ?? { fromNode: mediaNode(sourceId), toNode: targetId ? mediaNode(targetId) : null },
    );
  });
}

/** 钉屏幕媒体卡工具条容器 show 门（同插帧面板测试读取） */
function mediaFollowToolbarShow(): boolean | undefined {
  const frag = flowProps.current.followToolbarLayer as { props?: { children?: unknown } } | undefined;
  const children = frag?.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  const el = arr.find((c) => (c as { type?: unknown } | null)?.type === NodeFollowToolbar) as
    { props?: { show?: boolean } } | undefined;
  return el?.props?.show;
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  assetLibraryRecords.current = [];
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKIHPK 点「音视频合成」建草稿卡与面板跟随', () => {
  it('源音频卡右侧建视频型草稿卡（标注「音视频合成」+ 合成身份）+ 默认音频输入线 origin=audio-video-mux + 面板默认档', async () => {
    seedDoc();
    await renderPage();
    await compose();

    const draft = muxDraftNode()!;
    expect(draft).toBeTruthy();
    const data = draft.data as Record<string, unknown>;
    // 草稿卡从创建起即视频型并标注「音视频合成」（不是音频型占位卡）
    expect(data.mediaType).toBe('video');
    expect(data.fileName).toBe(AUDIO_VIDEO_MUX_TITLE);
    expect(data.draft).toBe(true);
    expect(data.genStatus).toBe('draft');
    // 合成身份：固定源节点/资产 + 默认参数（保留原声 + 保持原长）
    expect(identityOf(draft)).toEqual({
      sourceNodeId: 'a1',
      sourceAssetId: '8',
      reserveAudio: true,
      sync: 'none',
    });
    // 出生位在源音频卡右侧
    expect((draft.position as { x: number }).x).toBeGreaterThan(0);
    // 默认音频输入线：origin=audio-video-mux 语义边
    const audioEdge = edges().find((e) => e.target === draft.id)!;
    expect(audioEdge.source).toBe('a1');
    expect(audioEdge.data).toEqual({ origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN });

    // 面板跟随渲染：标题/两档/三档/免费徽标；未绑定发送置灰并提示
    expect(panel()).toBeTruthy();
    expect(document.body.textContent).toContain('原声处理');
    expect(reserveBtn(true)!.className).toMatch(/Active/);
    expect(reserveBtn(false)).toBeTruthy();
    expect(syncBtn('none')!.className).toMatch(/Active/);
    expect(syncBtn('video')).toBeTruthy();
    expect(syncBtn('audio')).toBeTruthy();
    expect(document.body.textContent).toContain('本期免费');
    expect(sendBtn()!.disabled).toBe(true);
    expect(sendBtn()!.getAttribute('title')).toBe('先选择视频');
    // 未绑定视频槽显示拖线引导与素材库次级入口
    expect(slot()!.textContent).toContain('拖线到本卡');
    expect(document.body.querySelector('[data-testid="audio-video-mux-library-open"]')).toBeTruthy();
  });

  it('门槛兜底：源音频未关联资产/URL 缺失时不建卡不开面板不建边（工具条置灰层另见 Toolbar.test）', async () => {
    seedDoc({ audioUnlinked: true });
    await renderPage();
    const data = mediaNode('a1').data as Record<string, unknown>;
    data.src = '';
    await compose();
    expect(muxDraftNode()).toBeUndefined();
    expect(panel()).toBeNull();
    expect(edges()).toHaveLength(0);
    expect(AUDIO_VIDEO_MUX_UNAVAILABLE_REASON).toBe('音频不可用，无法合成');
  });
});

describe('IKIHPK 面板参数写卡与发送 UI 态', () => {
  it('切「替换原声」「裁到视频长」即时写卡（重开恢复），发送钮未绑定仍置灰', async () => {
    seedDoc();
    await renderPage();
    await compose();
    const draftId = muxDraftNode()!.id;

    await click(reserveBtn(false));
    expect(reserveBtn(false)!.className).toMatch(/Active/);
    expect(reserveBtn(true)!.className).not.toMatch(/Active/);
    await click(syncBtn('video'));
    expect(syncBtn('video')!.className).toMatch(/Active/);
    expect(syncBtn('none')!.className).not.toMatch(/Active/);

    const identity = identityOf(mediaNode(draftId))!;
    expect(identity.reserveAudio).toBe(false);
    expect(identity.sync).toBe('video');
    // 未绑定视频：发送仍置灰
    expect(sendBtn()!.disabled).toBe(true);

    // 关闭面板后点草稿卡重开：参数从卡上恢复（持久化口径）
    await click(document.body.querySelector('[data-testid="audio-video-mux-close"]'));
    expect(panel()).toBeNull();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(draftId));
    });
    expect(panel()).toBeTruthy();
    expect(reserveBtn(false)!.className).toMatch(/Active/);
    expect(syncBtn('video')!.className).toMatch(/Active/);
  });

  it('已绑定后可点发送；本票只做 UI 态——点击不建任务、不改卡态（真实提交归 IKIHP M）', async () => {
    seedDoc({ withMuxDraft: true, withBound: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    expect(sendBtn()!.disabled).toBe(false);
    await click(sendBtn());
    const data = mediaNode('m1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('draft');
    expect(data.jobId).toBeUndefined();
    expect(edges()).toHaveLength(2); // 固定音频线 + 绑定线，未新增任务卡/边
    expect(mediaNode('m1')).toBeTruthy();
  });
});

describe('IKIHPK 拖线落点按目标卡身份分流', () => {
  it('视频卡拖线落到未绑定合成草稿卡：绑定边 origin=audio-video-mux + 写卡视频身份（不建普通参考线）', async () => {
    seedDoc();
    await renderPage();
    await compose();
    const draftId = muxDraftNode()!.id;

    await dropWire('v1', draftId);

    const bindEdges = edges().filter((e) => e.target === draftId && e.source === 'v1');
    expect(bindEdges).toHaveLength(1);
    expect(bindEdges[0]!.data).toEqual({ origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN });
    expect(edges().filter((e) => e.target === draftId)).toHaveLength(2); // 固定音频线 + 绑定线
    expect(identityOf(mediaNode(draftId))!.video).toEqual({
      assetId: '5',
      nodeId: 'v1',
      name: '城市夜景.mp4',
      duration: 12,
    });
    // 视频槽转入已绑定信息条：文件名 + 时长 + 来源标注「· 画布」
    expect(boundBar()).toBeTruthy();
    expect(boundBar()!.textContent).toContain('城市夜景.mp4');
    expect(boundBar()!.textContent).toContain('· 画布');
    expect(sendBtn()!.disabled).toBe(false);
  });

  it('已绑定草稿卡再拖另一个视频：替换绑定（仅一条绑定边，卡上身份随之更新）', async () => {
    seedDoc({ withMuxDraft: true, withBound: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });

    await dropWire('v2', 'm1');

    const bindEdges = edges().filter((e) => e.target === 'm1' && e.source !== 'a1');
    expect(bindEdges).toHaveLength(1);
    expect(bindEdges[0]!.source).toBe('v2');
    expect(identityOf(mediaNode('m1'))!.video).toEqual({
      assetId: '6',
      nodeId: 'v2',
      name: '产品开箱.mp4',
      duration: 45,
    });
    // 固定音频输入线不受影响
    expect(edges().some((e) => e.source === 'a1' && e.target === 'm1')).toBe(true);
  });

  it('同一视频重复拖到同一草稿卡：幂等（不重复建边、不重复写卡）', async () => {
    seedDoc({ withMuxDraft: true, withBound: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await dropWire('v1', 'm1');
    expect(edges().filter((e) => e.source === 'v1' && e.target === 'm1')).toHaveLength(1);
    expect(identityOf(mediaNode('m1'))!.video).toEqual({
      assetId: '5',
      nodeId: 'v1',
      name: '城市夜景.mp4',
      duration: 12,
    });
  });

  it('落到其他卡维持普通参考连线（不产生 origin=audio-video-mux 边）；落在合成草稿卡的同手势不误建普通线', async () => {
    seedDoc({ withMuxDraft: true });
    await renderPage();

    // 音频成品卡 → 视频成品卡：既有普通参考连线路径不变
    await dropWire('a1', 'v1');
    const plain = edges().find((e) => e.source === 'a1' && e.target === 'v1');
    expect(plain).toBeTruthy();
    expect(plain!.data).toBeUndefined();

    // 视频成品卡 → 合成草稿卡：只有绑定边（无双份普通参考线）
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await dropWire('v1', 'm1');
    const toMux = edges().filter((e) => e.target === 'm1');
    expect(toMux.map((e) => e.data?.origin)).toEqual([AUDIO_VIDEO_MUX_EDGE_ORIGIN, AUDIO_VIDEO_MUX_EDGE_ORIGIN]);
  });

  it('非视频源（音频卡）拖到合成草稿卡：不绑定、不建普通参考线（明确提示）', async () => {
    seedDoc({ withMuxDraft: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    await dropWire('a1', 'm1');
    // a1 → m1 只有既有固定音频线，未新增绑定线，草稿卡身份未写 video
    expect(edges().filter((e) => e.source === 'a1' && e.target === 'm1')).toHaveLength(1);
    expect(identityOf(mediaNode('m1'))!.video).toBeUndefined();
    expect(document.body.textContent).toContain('仅支持绑定视频卡');
  });

  it('拖到空白不绑定：草稿卡身份不变、无新增边', async () => {
    seedDoc({ withMuxDraft: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    const before = edges().length;
    await dropWire('v1', undefined, { fromNode: mediaNode('v1'), toNode: null });
    expect(edges()).toHaveLength(before);
    expect(identityOf(mediaNode('m1'))!.video).toBeUndefined();
  });
});

describe('IKIHPK 视频槽三态与素材库浮层', () => {
  it('拖线手势进行中：视频槽显示「绑定中」跟手态；松手落空白后回到未绑定引导', async () => {
    seedDoc();
    await renderPage();
    await compose();
    const draftId = muxDraftNode()!.id;

    await act(async () => {
      flowProps.current.onConnectStart('v1');
    });
    expect(document.body.querySelector('[data-testid="audio-video-mux-binding"]')).toBeTruthy();

    await dropWire('v1', undefined, { fromNode: mediaNode('v1'), toNode: null });
    expect(document.body.querySelector('[data-testid="audio-video-mux-binding"]')).toBeNull();
    expect(slot()!.textContent).toContain('拖线到本卡');
    expect(identityOf(mediaNode(draftId))!.video).toBeUndefined();
  });

  it('素材库浮层：单列表视频资产、选中即绑定不拉线、来源标注「· 素材库」；点外部关闭', async () => {
    assetLibraryRecords.current = [
      {
        id: 10241,
        name: '素材库视频 #10241',
        type: 'video',
        status: 'normal',
        url: 'http://vid/lib1.mp4',
        width: 1920,
        height: 1080,
        duration: 8,
      },
    ];
    seedDoc();
    await renderPage();
    await compose();
    const draftId = muxDraftNode()!.id;

    await click(document.body.querySelector('[data-testid="audio-video-mux-library-open"]'));
    const pop = libraryPop()!;
    expect(pop).toBeTruthy();
    // 素材库分页查询异步落地后渲染单列表
    await vi.waitFor(() => {
      expect(libraryPop()!.textContent).toContain('素材库视频 #10241');
    });
    // 单列表：无页签/无上传
    expect(pop.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(pop.querySelector('input[type="file"]')).toBeNull();

    // 点外部关闭（再开一次继续走绑定）
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(libraryPop()).toBeNull();
    await click(document.body.querySelector('[data-testid="audio-video-mux-library-open"]'));
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="audio-video-mux-library-10241"]')).toBeTruthy();
    });

    const before = edges().length;
    await click(document.body.querySelector('[data-testid="audio-video-mux-library-10241"]'));
    expect(libraryPop()).toBeNull();
    // 素材库来源不拉线
    expect(edges()).toHaveLength(before);
    expect(identityOf(mediaNode(draftId))!.video).toEqual({
      assetId: '10241',
      name: '素材库视频 #10241',
      duration: 8,
    });
    expect(boundBar()!.textContent).toContain('· 素材库');
  });

  it('素材库浮层 Esc 关闭：只关浮层不退会话（面板仍在）', async () => {
    assetLibraryRecords.current = [
      { id: 7, name: '素材库视频 #7', type: 'video', status: 'normal', url: 'http://vid/lib7.mp4', duration: 5 },
    ];
    seedDoc();
    await renderPage();
    await compose();
    await click(document.body.querySelector('[data-testid="audio-video-mux-library-open"]'));
    expect(libraryPop()).toBeTruthy();

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(libraryPop()).toBeNull();
    expect(panel()).toBeTruthy();
  });

  it('× 移除绑定：清卡上视频身份并回到未绑定引导；固定音频输入线保留', async () => {
    seedDoc({ withMuxDraft: true, withBound: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    expect(boundBar()).toBeTruthy();

    await click(document.body.querySelector('[data-testid="audio-video-mux-bound-remove"]'));
    expect(boundBar()).toBeNull();
    expect(slot()!.textContent).toContain('拖线到本卡');
    expect(identityOf(mediaNode('m1'))!.video).toBeUndefined();
    expect(edges().some((e) => e.source === 'v1' && e.target === 'm1')).toBe(false);
    expect(edges().some((e) => e.source === 'a1' && e.target === 'm1')).toBe(true);
    expect(sendBtn()!.disabled).toBe(true);

    // 可重新绑定
    await dropWire('v2', 'm1');
    expect(identityOf(mediaNode('m1'))!.video).toEqual({
      assetId: '6',
      nodeId: 'v2',
      name: '产品开箱.mp4',
      duration: 45,
    });
  });
});

describe('IKIHPK 语义边守卫（固定音频线不可单独删、绑定线删除即解绑）', () => {
  it('删除固定音频输入线被拦（边保留 + 提示），删除绑定线即解绑（槽回未绑定引导）', async () => {
    seedDoc({ withMuxDraft: true, withBound: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });

    // 固定音频线：删边被拦
    await act(async () => {
      flowProps.current.onEdgesChange([{ id: 'e-mux-audio', type: 'remove' }]);
    });
    expect(edges().some((e) => e.id === 'e-mux-audio')).toBe(true);
    expect(document.body.textContent).toContain('不可移除');

    // 绑定线：删边即解绑（卡上身份同步清除）
    await act(async () => {
      flowProps.current.onEdgesChange([{ id: 'e-mux-bind', type: 'remove' }]);
    });
    expect(edges().some((e) => e.id === 'e-mux-bind')).toBe(false);
    expect(identityOf(mediaNode('m1'))!.video).toBeUndefined();
    expect(boundBar()).toBeNull();
  });
});

describe('IKIHPK 会话注册、四退出与模态', () => {
  it('面板打开期间：全部媒体卡注入 soloToolbarHidden 且钉屏幕工具条 show 关闭；关闭后恢复', async () => {
    seedDoc();
    await renderPage();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('a1')], edges: [] });
    });
    await compose();

    for (const node of mediaNodes()) {
      expect((node.data as Record<string, unknown>).soloToolbarHidden).toBe(true);
    }
    expect(mediaFollowToolbarShow()).toBe(false);

    await click(document.body.querySelector('[data-testid="audio-video-mux-close"]'));
    for (const node of mediaNodes()) {
      expect((node.data as Record<string, unknown>).soloToolbarHidden).toBeUndefined();
    }
    expect(mediaFollowToolbarShow()).toBe(true);
    // 草稿卡与身份保留（未发送不自动清理）
    expect(muxDraftNode()).toBeTruthy();
  });

  it('Esc 退出会话（面板关闭、草稿卡保留）', async () => {
    seedDoc();
    await renderPage();
    await compose();
    const draftId = muxDraftNode()!.id;

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(panel()).toBeNull();
    expect(mediaNode(draftId)).toBeTruthy();
  });

  it('点画布空白退出会话；点其他卡（选中规范化）退出会话', async () => {
    seedDoc();
    await renderPage();
    await compose();
    const draftId = muxDraftNode()!.id;

    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(panel()).toBeNull();

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(draftId));
    });
    expect(panel()).toBeTruthy();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')], edges: [] });
    });
    expect(panel()).toBeNull();
    expect(mediaNode(draftId)).toBeTruthy();
  });

  it('互斥：进入去字幕编辑态时合成会话退出（面板关闭、草稿卡与绑定保留）', async () => {
    seedDoc({ withMuxDraft: true, withBound: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    expect(panel()).toBeTruthy();

    await act(async () => {
      ((mediaNode('v1').data as Record<string, unknown>).onVideoSubtitleErase as (id: string, mode?: string) => void)?.('v1', 'smart');
    });
    expect(panel()).toBeNull();
    expect(mediaNode('m1')).toBeTruthy();
    expect(identityOf(mediaNode('m1'))!.video).toEqual({
      assetId: '5',
      nodeId: 'v1',
      name: '城市夜景.mp4',
      duration: 12,
    });
    // 再进合成会话：绑定与参数恢复（合成身份记住直到回填）
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    expect(panel()).toBeTruthy();
    expect(boundBar()!.textContent).toContain('城市夜景.mp4');
  });

  it('草稿卡被删除时会话清理（面板关闭，无悬空会话）', async () => {
    seedDoc();
    await renderPage();
    await compose();
    const draftId = muxDraftNode()!.id;
    await act(async () => {
      ((mediaNode(draftId).data as Record<string, unknown>).onDelete as (id: string) => void)?.(draftId);
    });
    expect(panel()).toBeNull();
    expect(mediaNode(draftId)).toBeUndefined();
  });

  it('会话期打开生成面板（HD 参数面板）先退合成会话：面板关闭、草稿卡与绑定保留', async () => {
    seedDoc({ withMuxDraft: true, withBound: true, withHdDraft: true });
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('m1'));
    });
    expect(panel()).toBeTruthy();
    // HD 身份卡（既有面板准入链路：点卡 → openVideoEnhanceDraftDialog → exitEditSessionForGenPanel）
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('hd1'));
    });
    expect(document.body.querySelector('[data-testid="video-enhance-send-btn"]')).toBeTruthy();
    expect(panel()).toBeNull();
    expect(mediaNode('m1')).toBeTruthy();
    expect(identityOf(mediaNode('m1'))!.video).toBeTruthy();
  });
});
