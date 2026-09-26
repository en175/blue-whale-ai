// @vitest-environment jsdom
/* IKHK9N 智能抠像编辑态单条组件测试。X 关闭在单条最左（对齐去字幕/场景切分/音视频
   分离单条先例）；单条要素 = 模式标题（人像抠像/绿幕抠像，跟随入口下拉所选模式——
   单条内无模式切换控件，换模式 = 退出后从入口菜单重选，ADR-0112）+ 输出格式下拉
   （两档 WEBM 透明默认 / MP4 纯色、无 MOV 档；点击展开向上弹、当前项蓝底白字高亮）+
   背景色分段控件（仅 format=MP4 显示：白色默认/黑色/绿色——WEBM 透明无背景色）+
   ⚡0 免费徽标 + 发送钮（submitting 置灰与回调透传）；单条 territory 标记、sendBar
   锚样式透传。渲染模式沿用 VocalSplitDialog/VideoAudioSplitDialog 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SmartMattingDialog from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const closeMock = vi.fn();
const formatChangeMock = vi.fn();
const backgroundChangeMock = vi.fn();
const sendMock = vi.fn();

function renderDialog(props: Partial<Parameters<typeof SmartMattingDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(SmartMattingDialog, {
        onClose: closeMock,
        mode: 'portrait',
        format: 'WEBM',
        onFormatChange: formatChangeMock,
        backgroundColor: 'white',
        onBackgroundColorChange: backgroundChangeMock,
        onSend: sendMock,
        sendBarAnchor: null,
        ...props,
      } as Parameters<typeof SmartMattingDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(testId: string) {
  await act(async () => {
    btn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

describe('单条呈现', () => {
  it('X 关闭在单条最左（sendBar 后代且为第一个按钮），单条内无模式切换控件', () => {
    renderDialog();
    const sendBar = container!.querySelector('[data-testid="smart-matting-send-bar"]')!;
    const close = btn('smart-matting-close');
    expect(sendBar.contains(close)).toBe(true);
    expect(sendBar.querySelector('button')).toBe(close);
  });

  it('单条浮条标记 data-gen-panel-territory（豁免点外关闭误杀）', () => {
    renderDialog();
    expect(container!.querySelector('[data-testid="smart-matting-send-bar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
  });

  it('X 悬停说明退出语义（未发送不建任务不建卡）', () => {
    renderDialog();
    expect(btn('smart-matting-close').getAttribute('title')).toContain('未发送不建任务不建卡');
  });

  it('X 点击透传 onClose', async () => {
    renderDialog();
    await click('smart-matting-close');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('模式标题跟随所选模式：人像抠像 / 绿幕抠像（无模式切换控件）', () => {
    renderDialog({ mode: 'portrait' });
    expect(container!.querySelector('[data-testid="smart-matting-title"]')!.textContent).toBe('人像抠像');
    renderDialog({ mode: 'greenscreen' });
    expect(container!.querySelector('[data-testid="smart-matting-title"]')!.textContent).toBe('绿幕抠像');
  });

  it('⚡0 免费徽标齐备（本期免费 title）', () => {
    renderDialog();
    const badge = container!.querySelector('[data-testid="smart-matting-free-badge"]')!;
    expect(badge.textContent).toBe('0');
    expect(badge.getAttribute('title')).toBe('本期免费');
  });
});

describe('输出格式下拉（两档无 MOV）', () => {
  it('默认态触发钮显 WEBM 透明、菜单未展开', () => {
    renderDialog();
    expect(btn('smart-matting-format-trigger').textContent).toContain('WEBM 透明');
    expect(container!.querySelector('[data-testid="smart-matting-format-menu"]')).toBeNull();
  });

  it('点击展开两档（契约 WEBM/MP4，无 MOV）、当前项高亮；选择派发并收起', async () => {
    renderDialog({ format: 'WEBM' });
    await click('smart-matting-format-trigger');
    const menu = container!.querySelector('[data-testid="smart-matting-format-menu"]')!;
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['WEBM 透明', 'MP4 纯色']);
    expect(btn('smart-matting-format-item-WEBM').getAttribute('aria-checked')).toBe('true');
    expect(btn('smart-matting-format-item-MP4').getAttribute('aria-checked')).toBe('false');
    await click('smart-matting-format-item-MP4');
    expect(formatChangeMock).toHaveBeenCalledWith('MP4');
    expect(container!.querySelector('[data-testid="smart-matting-format-menu"]')).toBeNull();
  });

  it('点外关闭已展开的格式下拉', async () => {
    renderDialog();
    await click('smart-matting-format-trigger');
    expect(container!.querySelector('[data-testid="smart-matting-format-menu"]')).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="smart-matting-format-menu"]')).toBeNull();
  });
});

describe('背景色分段控件（仅 MP4 显示）', () => {
  it('格式为 WEBM 时不渲染背景色控件（透明背景无配色语义）', () => {
    renderDialog({ format: 'WEBM' });
    expect(container!.querySelector('[data-testid="smart-matting-background"]')).toBeNull();
  });

  it('格式为 MP4 时渲染白/黑/绿三档、当前项高亮、选择派发', async () => {
    renderDialog({ format: 'MP4', backgroundColor: 'white' });
    const group = container!.querySelector('[data-testid="smart-matting-background"]')!;
    const items = group.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['白色', '黑色', '绿色']);
    expect(btn('smart-matting-background-white').getAttribute('aria-checked')).toBe('true');
    expect(btn('smart-matting-background-black').getAttribute('aria-checked')).toBe('false');
    await click('smart-matting-background-green');
    expect(backgroundChangeMock).toHaveBeenCalledWith('green');
  });
});

describe('发送钮', () => {
  it('激活态点击透传 onSend', async () => {
    renderDialog();
    await click('smart-matting-send-btn');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('submitting 只读：格式下拉、背景色分段与发送钮置灰不可点', async () => {
    renderDialog({ format: 'MP4', submitting: true });
    expect(btn('smart-matting-format-trigger').disabled).toBe(true);
    expect(btn('smart-matting-background-white').disabled).toBe(true);
    const sendBtn = btn('smart-matting-send-btn');
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.className).not.toContain('sendBtnActive');
    await click('smart-matting-send-btn');
    expect(sendMock).not.toHaveBeenCalled();
    await click('smart-matting-format-trigger');
    expect(container!.querySelector('[data-testid="smart-matting-format-menu"]')).toBeNull();
    await click('smart-matting-background-black');
    expect(backgroundChangeMock).not.toHaveBeenCalled();
  });
});

describe('锚样式透传', () => {
  it('sendBar 锚定时 inline left/top 生效并加 sendBarFollow（无锚不注入 style 定位）', () => {
    renderDialog({ sendBarAnchor: { left: 120, top: 320 } });
    const sendBar = container!.querySelector('[data-testid="smart-matting-send-bar"]') as HTMLElement;
    expect(sendBar.style.left).toBe('120px');
    expect(sendBar.style.top).toBe('320px');
    expect(sendBar.className).toContain('sendBarFollow');
    renderDialog({ sendBarAnchor: null });
    const unanchoredBar = container!.querySelector('[data-testid="smart-matting-send-bar"]') as HTMLElement;
    expect(unanchoredBar.className).not.toContain('sendBarFollow');
    expect(unanchoredBar.style.left).toBe('');
  });
});
