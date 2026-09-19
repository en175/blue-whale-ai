// @vitest-environment jsdom
/* IKH3OU/IKH3OV 去字幕会话单条组件测试（IKGZ83 双条 → 单条化，ADR-0104）：形态随 mode 切换——
   智能模式仅 X/「智能擦除」/⚡0/发送四元素（零框选工具、无？帮助、无重置），框选模式按
   「框选擦除 ？ | 框选/撤销/重做/重置」补齐四控件；唯一一条浮条、标记 data-gen-panel-territory；
   ⚡0 徽标取代「本期免费」文字、「输出最高 1080P」挪到发送钮 title；框选模式无框时发送钮
   按父级 sendBlockedReason 置灰（title 即拦发原因）、重置钮无框可清时置灰；
   撤销重做重置与发送中置灰透传、框满置灰。
   渲染模式沿用 ImageEraseDialog 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoSubtitleEraseDialog from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const sendMock = vi.fn();
const undoMock = vi.fn();
const redoMock = vi.fn();
const resetMock = vi.fn();
const closeMock = vi.fn();

function renderDialog(props: Partial<Parameters<typeof VideoSubtitleEraseDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(VideoSubtitleEraseDialog, {
        mode: 'box',
        onClose: closeMock,
        onSend: sendMock,
        canUndo: false,
        canRedo: false,
        canReset: false,
        onUndo: undoMock,
        onRedo: redoMock,
        onReset: resetMock,
        boxLimitReached: false,
        sendBlockedReason: null,
        sendBarAnchor: null,
        ...props,
      } as Parameters<typeof VideoSubtitleEraseDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
const has = (testId: string) => container!.querySelector(`[data-testid="${testId}"]`) != null;
const sendBar = () => container!.querySelector('[data-testid="subtitle-erase-send-bar"]')!;

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKH3OU 单条两形态', () => {
  it('智能模式仅四元素：X / 智能擦除 / ⚡0 / 发送——零框选工具、无？帮助无重置', () => {
    renderDialog({ mode: 'smart' });
    expect(btn('subtitle-erase-close')).toBeTruthy();
    expect(btn('subtitle-erase-title').textContent).toBe('智能擦除');
    expect(btn('subtitle-erase-free-badge')).toBeTruthy();
    expect(btn('subtitle-erase-send-btn')).toBeTruthy();
    // 零框选工具：？帮助/框选/撤销/重做/重置一律不渲染（规格：智能模式无？帮助）
    for (const id of ['subtitle-erase-help', 'subtitle-erase-tool-box', 'subtitle-erase-undo', 'subtitle-erase-redo', 'subtitle-erase-reset']) {
      expect(has(id), id).toBe(false);
    }
    // X 在最左
    const bar = sendBar();
    expect(bar.firstElementChild).toBe(btn('subtitle-erase-close'));
  });

  it('框选模式完整单条按序齐备：X / 框选擦除 / ？ / 框选·撤销·重做·重置 / ⚡0 / 发送', () => {
    renderDialog({ mode: 'box' });
    expect(btn('subtitle-erase-title').textContent).toBe('框选擦除');
    const order = Array.from(sendBar().querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual([
      'subtitle-erase-close',
      'subtitle-erase-title',
      'subtitle-erase-help',
      'subtitle-erase-tool-box',
      'subtitle-erase-undo',
      'subtitle-erase-redo',
      'subtitle-erase-reset',
      'subtitle-erase-free-badge',
      'subtitle-erase-send-btn',
    ]);
  });

  it('？帮助是紧跟标题后的无交互元素，title 讲清框与擦除范围的关系', () => {
    renderDialog({ mode: 'box' });
    const help = sendBar().querySelector('[data-testid="subtitle-erase-help"]')!;
    expect(help.tagName).toBe('SPAN');
    expect(help.getAttribute('title')).toContain('框内');
    expect(help.getAttribute('title')).toContain('全片');
    expect(help.getAttribute('title')).toContain('20');
  });

  it('只渲染下方一条：上方工具条与「全画面文字」开关一并退役', () => {
    renderDialog({ mode: 'box' });
    expect(has('subtitle-erase-toolbar')).toBe(false);
    expect(has('subtitle-erase-full-text-toggle')).toBe(false);
    // 组件内仅一条浮条（data-gen-panel-territory 唯一，豁免点外关闭误杀）
    expect(container!.querySelectorAll('[data-gen-panel-territory]').length).toBe(1);
    expect(sendBar().hasAttribute('data-gen-panel-territory')).toBe(true);
    expect(container!.textContent).not.toContain('全画面文字');
  });

  it('⚡0 徽标取代「本期免费」文字（免费语义转 title）；「输出最高 1080P」不再作条内文字', () => {
    renderDialog({ mode: 'smart' });
    const badge = sendBar().querySelector('[data-testid="subtitle-erase-free-badge"]')!;
    expect(badge.textContent).toBe('0');
    expect(badge.getAttribute('title')).toBe('本期免费');
    expect(sendBar().textContent).not.toContain('本期免费');
    expect(sendBar().textContent).not.toContain('输出最高 1080P');
  });

  it('发送钮 title 两模式各表发送语义且都含「输出最高 1080P」', () => {
    renderDialog({ mode: 'smart' });
    expect(btn('subtitle-erase-send-btn').getAttribute('title')).toContain('自动擦除画面下半字幕');
    expect(btn('subtitle-erase-send-btn').getAttribute('title')).toContain('输出最高 1080P');
    renderDialog({ mode: 'box' });
    expect(btn('subtitle-erase-send-btn').getAttribute('title')).toContain('检测框');
    expect(btn('subtitle-erase-send-btn').getAttribute('title')).toContain('输出最高 1080P');
  });

  it('框选是框选模式唯一工具恒激活（aria-pressed=true）；框满时置灰并提示上限', () => {
    renderDialog({ mode: 'box' });
    expect(btn('subtitle-erase-tool-box').getAttribute('aria-pressed')).toBe('true');
    renderDialog({ mode: 'box', boxLimitReached: true });
    expect(btn('subtitle-erase-tool-box').disabled).toBe(true);
    expect(btn('subtitle-erase-tool-box').getAttribute('title')).toContain('20 个上限');
  });
});

describe('IKH3OV 重置与必框发送', () => {
  it('重置钮：无框可清时置灰并说明，有框时可用且点击透传', async () => {
    renderDialog({ mode: 'box' });
    expect(btn('subtitle-erase-reset').disabled).toBe(true);
    expect(btn('subtitle-erase-reset').getAttribute('title')).toContain('没有可清空的检测框');
    renderDialog({ mode: 'box', canReset: true });
    expect(btn('subtitle-erase-reset').disabled).toBe(false);
    expect(btn('subtitle-erase-reset').getAttribute('title')).toContain('可撤销');
    await click(btn('subtitle-erase-reset'));
    expect(resetMock).toHaveBeenCalledTimes(1);
  });

  it('框选模式无框：发送钮置灰且 title 即父级拦发原因，点击不派发；有框恢复可发', async () => {
    const blockedReason = '请先拉框：在画面上拉矩形框圈出要擦除的字幕区域';
    renderDialog({ mode: 'box', sendBlockedReason: blockedReason });
    expect(btn('subtitle-erase-send-btn').disabled).toBe(true);
    expect(btn('subtitle-erase-send-btn').getAttribute('title')).toBe(blockedReason);
    await click(btn('subtitle-erase-send-btn'));
    expect(sendMock).not.toHaveBeenCalled();
    // 有框（父级不再拦）：发送钮恢复可用，title 回到发送语义 + 输出规格
    renderDialog({ mode: 'box', sendBlockedReason: null });
    expect(btn('subtitle-erase-send-btn').disabled).toBe(false);
    expect(btn('subtitle-erase-send-btn').getAttribute('title')).toContain('输出最高 1080P');
  });

  it('发送中（submitting）：重置钮同样只读', async () => {
    renderDialog({ mode: 'box', submitting: true, canReset: true });
    expect(btn('subtitle-erase-reset').disabled).toBe(true);
    await click(btn('subtitle-erase-reset'));
    expect(resetMock).not.toHaveBeenCalled();
  });
});

describe('IKH3OU 回调透传与只读', () => {
  it('撤销/重做置灰透传：无操作禁用，可用时点击回调', async () => {
    renderDialog({ mode: 'box' });
    expect(btn('subtitle-erase-undo').disabled).toBe(true);
    expect(btn('subtitle-erase-redo').disabled).toBe(true);
    renderDialog({ mode: 'box', canUndo: true, canRedo: true });
    expect(btn('subtitle-erase-undo').disabled).toBe(false);
    expect(btn('subtitle-erase-redo').disabled).toBe(false);
    await click(btn('subtitle-erase-undo'));
    expect(undoMock).toHaveBeenCalledTimes(1);
    await click(btn('subtitle-erase-redo'));
    expect(redoMock).toHaveBeenCalledTimes(1);
  });

  it('X 关闭与发送回调透传；智能模式发送钮默认可发（无框直发）', async () => {
    renderDialog({ mode: 'smart' });
    expect(btn('subtitle-erase-send-btn').disabled).toBe(false);
    await click(btn('subtitle-erase-send-btn'));
    expect(sendMock).toHaveBeenCalledTimes(1);
    await click(btn('subtitle-erase-close'));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('发送中（submitting）：全部控件只读防重复提交', async () => {
    renderDialog({ mode: 'box', submitting: true, canUndo: true, canReset: true });
    expect(btn('subtitle-erase-send-btn').disabled).toBe(true);
    expect(btn('subtitle-erase-undo').disabled).toBe(true);
    expect(btn('subtitle-erase-tool-box').disabled).toBe(true);
    expect(btn('subtitle-erase-reset').disabled).toBe(true);
    await click(btn('subtitle-erase-send-btn'));
    await click(btn('subtitle-erase-undo'));
    expect(sendMock).not.toHaveBeenCalled();
    expect(undoMock).not.toHaveBeenCalled();
    expect(btn('subtitle-erase-send-btn').getAttribute('title')).toBe('正在发送，请稍候');
  });
});

/* ===== IKH25A 单条跟随态 CSS 中心点锚（CSS 源断言，先例 CropDialog IKH1WI describe）：
   跟随锚 left 是源卡中心 x，真居中由基础 .sendBar 的 translateX(-50%) 完成；
   .sendBarFollow 对齐 CropDialog .panelFollow 先例（left:0 兜底 inline 缺失，
   transform 不覆盖 → 继承基础态完成真居中，不再对中心点锚二次左移）。
   IKH3OU 单条化后成员数从两条降为一条，退役样式块一并删除。 ===== */
describe('IKH25A 单条跟随态 CSS 中心点锚', () => {
  const css = readFileSync(resolve('src/pages/CanvasPage/components/VideoSubtitleEraseDialog/index.module.css'), 'utf-8');
  const block = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('基础 .sendBar 保留 translateX(-50%)：中心点锚的真居中由自身 transform 完成', () => {
    expect(block('\\.sendBar')).toContain('translateX(-50%)');
  });

  it('.sendBarFollow 对齐先例：left: 0 + bottom: auto，不覆盖 transform（继承真居中）', () => {
    const follow = block('\\.sendBarFollow');
    expect(follow).toContain('bottom: auto');
    expect(follow).toContain('left: 0');
    expect(follow).not.toContain('transform');
  });

  it('退役样式已删除：上方工具条容器与「全画面文字」开关块不留死样式', () => {
    expect(block('\\.toolbar')).toBe('');
    expect(block('\\.fullTextToggle')).toBe('');
    expect(block('\\.togglePill')).toBe('');
    expect(block('\\.toggleKnob')).toBe('');
    // 输出最高 1080P 已挪到发送钮 title，条内说明文字样式同步退役
    expect(block('\\.sendHint')).toBe('');
  });
});
