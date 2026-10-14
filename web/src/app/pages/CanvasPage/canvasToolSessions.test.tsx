import { isValidElement, type ReactNode } from 'react';
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { canvasToolSessionFixture } from './testing/canvasToolSessionFixture';

const fixture = canvasToolSessionFixture();
const editing = fixture.tools.kinds.filter(
  (kind) =>
    fixture.tools.entries[kind].handle.getSnapshot().visible === undefined,
);
const pairs = editing.flatMap((from) =>
  editing.filter((to) => to !== from).map((to) => [from, to] as const),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('真实唯一注册入口包含13编辑和3面板，形成156个有向切换', () => {
  expect(editing).toHaveLength(13);
  expect(fixture.tools.kinds).toHaveLength(16);
  expect(pairs).toHaveLength(156);
});
it.each(pairs)(
  '%s 切到 %s：清旧界面，进入新工具，关闭生成面板且不发送',
  (from, to) => {
    const f = canvasToolSessionFixture();
    expect(f.open[from]()).toBe(true);
    const firstDismissed = f.dismissed();
    f.launch[to]();
    expect(f.tools.entries[from].handle.getSnapshot().state).toBeNull();
    expect(f.tools.entries[to].handle.getSnapshot().state).not.toBeNull();
    expect(f.dismissed()).toBe(firstDismissed + 1);
    expect(f.taskCount()).toBe(0);
    expect(f.draftCount()).toBe(
      Number(from === 'audioVideoMux') + Number(to === 'audioVideoMux'),
    );
  },
);
it.each(editing)(
  '%s 同 kind 重入、同卡 close/reopen 都是新会话并清提交锁',
  (kind) => {
    const f = canvasToolSessionFixture();
    f.open[kind]();
    const before = f.tools.entries[kind].handle.getSnapshot().state;
    f.open[kind]();
    expect(f.tools.entries[kind].handle.getSnapshot().state).not.toBe(before);
    f.tools.entries[kind].handle.close();
    expect(f.tools.entries[kind].handle.getSnapshot().state).toBeNull();
    f.open[kind]();
    expect(f.tools.entries[kind].handle.getSnapshot().state).not.toBeNull();
    expect(f.tools.entries[kind].handle.getSnapshot().submitting).toBe(false);
  },
);
it.each(
  editing.flatMap((kind) =>
    ['close', 'escape', 'selection', 'pane', 'generation', 'delete'].map(
      (route) => [kind, route] as const,
    ),
  ),
)('%s 经 %s 完整退出；空 selection 保持', (kind, route) => {
  const f = canvasToolSessionFixture();
  f.open[kind]();
  const old = f.tools.entries[kind].handle.getSnapshot().state;
  f.tools.runtime.onSelectionChange(
    { soloId: null, multiSelect: false },
  );
  expect(f.tools.entries[kind].handle.getSnapshot().state).toBe(old);
  if (route === 'close') f.tools.entries[kind].handle.close();
  if (route === 'escape') {
    if (kind === 'cutout' || kind === 'outpaint') {
      expect(f.tools.runtime.onEscape()).toBe(false);
      f.tools.dedicatedEscape();
    } else expect(f.tools.runtime.onEscape()).toBe(true);
  }
  if (route === 'selection') {
    if (kind === 'cutout' || kind === 'outpaint') {
      expect(
        f.tools.runtime.onSelectionChange(
          { soloId: 'other', multiSelect: false },
        ),
      ).toBe(true);
      expect(f.tools.runtime.onNodeClick('other', f.deps)).toBe('consumed');
      expect(f.selected).toEqual(['other']);
    } else
      f.tools.runtime.onSelectionChange(
        { soloId: 'other', multiSelect: false },
      );
  }
  if (route === 'pane')
    expect(f.tools.runtime.onPaneClick()).toBe('consumed');
  if (route === 'generation') f.tools.runtime.beforeGenPanel();
  if (route === 'delete') f.tools.runtime.reconcileSources(new Set());
  expect(f.tools.entries[kind].handle.getSnapshot()).toEqual({
    state: null,
    submitting: false,
  });
  expect(f.taskCount()).toBe(0);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
it.each(
  fixture.tools.kinds.flatMap((kind) =>
    ['close', 'reopen', 'switch', 'project'].flatMap((change) =>
      ['success', 'failure'].map((outcome) => [kind, change, outcome] as const),
    ),
  ),
)(
  '%s 经 %s 后旧 %s 不关新会话、不重置新锁、不弹旧错误',
  async (kind, change, outcome) => {
    if (kind === 'crop') {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage() {},
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
        (done) => done(new Blob(['image'], { type: 'image/png' })),
      );
      vi.stubGlobal(
        'Image',
        class {
          onload: (() => void) | null = null;
          set src(_value: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
    }
    const f = canvasToolSessionFixture();
    f.open[kind]();
    expect(f.send[kind]()).toBe(true);
    await settle();
    expect(f.pending).toHaveLength(1);
    if (change === 'project') f.setProject('p2');
    else if (change === 'switch')
      f.open[kind === 'audioTrim' ? 'crop' : 'audioTrim']();
    else f.tools.entries[kind].handle.close();
    if (change !== 'close') {
      f.open[kind]();
      const accepted = f.send[kind]();
      if (kind === 'audioMix' || kind === 'audioVideoMux')
        expect(accepted).toBe(false);
      else expect(accepted).toBe(true);
      await settle();
    }
    const before = f.tools.entries[kind].handle.getSnapshot();
    if (outcome === 'success') f.pending[0].resolve();
    else f.pending[0].reject(new Error('旧请求失败'));
    await settle();
    expect(f.tools.entries[kind].handle.getSnapshot()).toEqual(before);
    expect(f.errors).toEqual([]);
    if (kind === 'audioMix' || kind === 'audioVideoMux')
      expect(f.inFlight()).toBe(false);
    vi.unstubAllGlobals();
  },
);

it.each(fixture.tools.kinds)(
  '%s 原MediaNode入口一次注册即产生唯一界面输出及所需节点/专属层接线',
  (kind) => {
    const f = canvasToolSessionFixture();
    f.launch[kind]();
    expect(f.tools.entries[kind].handle.getSnapshot().state).not.toBeNull();
    expect(
      f.tools
        .render()
        .filter(
          (element) =>
            isValidElement<{ children: ReactNode }>(element) &&
            element.props.children,
        ),
    ).toHaveLength(1);
    const source = f.nodes.find(
      (node) =>
        node.id ===
        (['erase', 'cutout', 'crop', 'outpaint'].includes(kind)
          ? 'image'
          : ['audioTrim', 'audioSpeed', 'audioMix'].includes(kind)
            ? 'audio'
            : 'video'),
    )!;
    const decorated = f.tools.decorateNode(source);
    if (kind === 'erase')
      expect(decorated.data.eraseEditing).toHaveProperty('onStrokeStart');
    if (kind === 'subtitleErase')
      expect(decorated.data.subtitleErasePaused).toBe(true);
    if (
      ['audioVideoSplit', 'vocalSplit', 'sceneSplit', 'smartMatting'].includes(
        kind,
      )
    )
      expect(decorated.data.splitEditing).toBe(true);
    if (kind === 'audioTrim')
      expect(decorated.data.trimEditing).toHaveProperty('onSelectionChange');
    if (kind === 'audioSpeed')
      expect(decorated.data.speedEditing).toEqual({ speed: 1 });
    if (kind === 'crop')
      expect(f.tools.canvasLayers().cropFrame).toHaveProperty('onRectChange');
    if (kind === 'outpaint') {
      expect(f.tools.canvasLayers().outpaintFrame).toHaveProperty(
        'onExpandChange',
      );
      expect(f.tools.blocksCanvasDrag()).toBe(true);
    }
    if (kind === 'imageEnhance' || kind === 'videoEnhance')
      expect(f.tools.isModal()).toBe(false);
    else expect(f.tools.isModal()).toBe(true);
    expect(f.taskCount()).toBe(0);
  },
);
it.each(['imageEnhance', 'videoEnhance', 'frameInterpolation'] as const)(
  '%s 任务宿主先返回已建草稿id，注册绑定决定打开面板；创建门槛未通过时保持旧会话',
  (kind) => {
    const f = canvasToolSessionFixture();
    f.open.audioTrim();
    const blocked = () => undefined;
    if (kind === 'imageEnhance') f.view.createEnhanceDraft = blocked;
    if (kind === 'videoEnhance') f.view.createVideoEnhanceDraft = blocked;
    if (kind === 'frameInterpolation')
      f.view.createFrameInterpolationDraft = blocked;
    f.launch[kind]();
    expect(f.tools.entries[kind].handle.getSnapshot().state).toBeNull();
    expect(f.tools.entries.audioTrim.handle.getSnapshot().state).not.toBeNull();
  },
);

it.each(['imageEnhance', 'videoEnhance', 'frameInterpolation'] as const)('%s 仅面板可见性决定公共Esc监听挂载，隐藏绑定不伪装成编辑会话', (kind) => {
  const f = canvasToolSessionFixture();
  f.open[kind]();
  expect(f.tools.runtime.hasEscExitSession()).toBe(false);
  f.tools.runtime.onSelectionChange({ soloId: 'other', multiSelect: false });
  expect(f.tools.hasPanel()).toBe(false);
  expect(f.tools.entries[kind].handle.getSnapshot().state).not.toBeNull();
  expect(f.tools.runtime.hasEscExitSession()).toBe(false);
});
