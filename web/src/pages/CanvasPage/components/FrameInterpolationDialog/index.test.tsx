// @vitest-environment jsdom
/* IKHLKR 视频插帧面板组件测试：三档渲染与默认 60fps（契约默认档单源）、切换即时回传、
   免费文案、发送钮悬停「智能补帧，最高可至 120fps」、关闭、参数回填、只读态
   （generating/submitting 冻结）。渲染模式沿用 VideoEnhanceDialog/index.test.tsx
   （createRoot + act，不用 testing-library）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FrameInterpolationDialog from './index';
import { FRAME_INTERPOLATION_SEND_HINT, frameInterpolationDisplayName } from '../../frameInterpolation';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let sendMock: ReturnType<typeof vi.fn>;
let paramsChangeMock: ReturnType<typeof vi.fn>;
let closeMock: ReturnType<typeof vi.fn>;

function renderPanel(props: Partial<Parameters<typeof FrameInterpolationDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(FrameInterpolationDialog, {
        onClose: closeMock,
        onSend: sendMock,
        onParamsChange: paramsChangeMock,
        ...props,
      } as Parameters<typeof FrameInterpolationDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sendMock = vi.fn(() => false); // IKHLKX 接线前父级发送空实现恒返回 false（面板保持打开）
  paramsChangeMock = vi.fn();
  closeMock = vi.fn();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe('IKHLKR 插帧面板三档渲染与默认值', () => {
  it('默认 60fps（契约默认档单源），三档齐备，标题「视频插帧」+ 字段「目标帧率」', () => {
    renderPanel();
    expect(btn('frame-interpolation-fps-60').className).toMatch(/Active/);
    expect(btn('frame-interpolation-fps-30').textContent).toBe('30fps');
    expect(btn('frame-interpolation-fps-120').textContent).toBe('120fps');
    expect(container!.textContent).toContain('视频插帧');
    expect(container!.textContent).toContain('目标帧率');
    // 极简骨架：无供应商/模型下拉、无高级参数
    expect(container!.textContent).not.toContain('供应商');
    expect(container!.textContent).not.toContain('高级参数');
  });

  it('面板领土标记在（点外关闭豁免链）', () => {
    renderPanel();
    expect(container!.querySelector('[data-gen-panel-territory]')).toBeTruthy();
  });

  it('切换三档分段即时生效：选中态切换并回传 onParamsChange（写卡持久化 lastParams + 卡名）', async () => {
    renderPanel();
    await click(btn('frame-interpolation-fps-120'));
    expect(btn('frame-interpolation-fps-120').className).toMatch(/Active/);
    expect(btn('frame-interpolation-fps-60').className).not.toMatch(/Active/);
    expect(paramsChangeMock).toHaveBeenCalledWith(120);
    await click(btn('frame-interpolation-fps-30'));
    expect(btn('frame-interpolation-fps-30').className).toMatch(/Active/);
    expect(paramsChangeMock).toHaveBeenLastCalledWith(30);
  });

  it('回填 initialFps（lastParams 恢复；关闭重开/刷新同源）', () => {
    renderPanel({ initialFps: 120 });
    expect(btn('frame-interpolation-fps-120').className).toMatch(/Active/);
    expect(btn('frame-interpolation-fps-60').className).not.toMatch(/Active/);
  });

  it('重复点击当前档不回传 onParamsChange', async () => {
    renderPanel();
    await click(btn('frame-interpolation-fps-60'));
    expect(paramsChangeMock).not.toHaveBeenCalled();
  });
});

describe('IKHLKR 本期免费与发送钮（IKHLKX 接线点）', () => {
  it('免费文案呈现；发送钮悬停「智能补帧，最高可至 120fps」', () => {
    renderPanel();
    expect(container!.textContent).toContain('本期免费');
    expect(btn('frame-interpolation-send-btn').getAttribute('title')).toBe(FRAME_INTERPOLATION_SEND_HINT);
    expect(FRAME_INTERPOLATION_SEND_HINT).toBe('智能补帧，最高可至 120fps');
  });

  it('发送未接线（本票空实现）：onSend 收到当前帧率，返回 false 面板保持打开，无受理假象', async () => {
    renderPanel();
    await click(btn('frame-interpolation-fps-30'));
    await click(btn('frame-interpolation-send-btn'));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(30);
    // 返回 false → 父级不关面板，面板仍在 DOM（未进入生成中，可继续调档）
    expect(btn('frame-interpolation-send-btn')).toBeTruthy();
    expect(container!.textContent).not.toContain('生成中，参数只读');
  });

  it('点关闭钮派发 onClose（关闭不丢参数：写卡在切换时已完成）', async () => {
    renderPanel();
    await click(btn('frame-interpolation-close-btn'));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

describe('IKHLKR 只读态（generating/submitting 冻结）', () => {
  it('生成中：三档与发送钮冻结，只读提示可见，悬停切换为只读原因', () => {
    renderPanel({ generating: true, initialFps: 120 });
    expect(container!.textContent).toContain('生成中，参数只读');
    expect(btn('frame-interpolation-fps-30').disabled).toBe(true);
    expect(btn('frame-interpolation-fps-120').disabled).toBe(true);
    expect(btn('frame-interpolation-send-btn').disabled).toBe(true);
    expect(btn('frame-interpolation-send-btn').getAttribute('title')).toContain('生成中，参数只读');
  });

  it('提交中：同样只读冻结（口径同 HD 面板 submitting），切档不回传', async () => {
    renderPanel({ submitting: true });
    expect(container!.textContent).toContain('正在保存并提交，参数只读');
    expect(btn('frame-interpolation-send-btn').disabled).toBe(true);
    await click(btn('frame-interpolation-fps-120'));
    expect(paramsChangeMock).not.toHaveBeenCalled();
  });

  it('卡名纯函数与档位一致（面板文案与草稿卡名同源）', () => {
    expect(frameInterpolationDisplayName(60)).toBe('插帧 · 60fps');
    expect(frameInterpolationDisplayName(120)).toBe('插帧 · 120fps');
  });
});
