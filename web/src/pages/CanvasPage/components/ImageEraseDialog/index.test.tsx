// @vitest-environment jsdom
/* IKGOTB 擦除编辑态工具条/发送条组件测试：控件齐全与互斥、发送门（无涂区/分辨率缺失/发送中）、
   清除文字直发、涂抹发送（栅格化 → onSendMask 收 File）、撤销重做置灰透传。
   渲染模式沿用 ImageEnhanceDialog 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageEraseDialog from './index';
import type { MaskOp } from '../../eraseMask';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const sendTextMock = vi.fn((): boolean => true);
const sendMaskMock = vi.fn(async (_file: File | null): Promise<boolean> => true);
const toolChangeMock = vi.fn();
const brushChangeMock = vi.fn();
const undoMock = vi.fn();
const redoMock = vi.fn();
const closeMock = vi.fn();

const OPS_WITH_PAINT: MaskOp[] = [
  { kind: 'rect', erase: false, from: { x: 10, y: 10 }, to: { x: 200, y: 150 } },
];

function renderDialog(props: Partial<Parameters<typeof ImageEraseDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(ImageEraseDialog, {
        onClose: closeMock,
        onSendTextErase: sendTextMock,
        onSendMask: sendMaskMock,
        tool: 'brush',
        onToolChange: toolChangeMock,
        brushRadius: 20,
        onBrushRadiusChange: brushChangeMock,
        canUndo: false,
        canRedo: false,
        onUndo: undoMock,
        onRedo: redoMock,
        hasPaint: false,
        maskSpace: { displayWidth: 280, displayHeight: 158, naturalWidth: 1600, naturalHeight: 900 },
        ops: [],
        toolbarAnchor: null,
        sendBarAnchor: null,
        ...props,
      } as Parameters<typeof ImageEraseDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** canvas stub：jsdom 无 2d context/toBlob */
function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '', strokeStyle: '', lineCap: '', lineJoin: '', lineWidth: 0,
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (this: HTMLCanvasElement, callback: (blob: Blob | null) => void) {
      callback(new Blob(['mask'], { type: 'image/png' }));
    } as HTMLCanvasElement['toBlob'],
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stubCanvas();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKGOTB 工具条与发送条呈现', () => {
  it('两条齐全：工具条标题/清除文字/画笔/框选/橡皮/笔刷/撤销/重做/X；发送条本期免费+发送', () => {
    renderDialog();
    expect(container!.querySelector('[data-testid="erase-toolbar"]')!.textContent).toContain('擦除');
    expect(container!.querySelector('[data-testid="erase-toolbar"]')!.textContent).toContain('清除文字');
    for (const id of ['erase-tool-brush', 'erase-tool-rect', 'erase-tool-eraser', 'erase-brush-size', 'erase-undo', 'erase-redo', 'erase-close']) {
      expect(btn(id), id).toBeTruthy();
    }
    const sendBar = container!.querySelector('[data-testid="erase-send-bar"]')!;
    expect(sendBar.textContent).toContain('本期免费');
    expect(btn('erase-send-btn')).toBeTruthy();
  });

  it('两条浮条均标记 data-gen-panel-territory（豁免点外关闭误杀）', () => {
    renderDialog();
    expect(container!.querySelector('[data-testid="erase-toolbar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
    expect(container!.querySelector('[data-testid="erase-send-bar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
  });

  it('当前工具高亮由 props 受控（tool=rect 时框选激活、画笔不激活）', () => {
    renderDialog({ tool: 'rect' });
    expect(btn('erase-tool-rect').getAttribute('aria-pressed')).toBe('true');
    expect(btn('erase-tool-brush').getAttribute('aria-pressed')).toBe('false');
  });

  it('点工具按钮上抛切换；撤销/重做/关闭回调透传', async () => {
    renderDialog({ canUndo: true, canRedo: true });
    await click(btn('erase-tool-eraser'));
    expect(toolChangeMock).toHaveBeenCalledWith('eraser');
    await click(btn('erase-undo'));
    expect(undoMock).toHaveBeenCalledTimes(1);
    await click(btn('erase-redo'));
    expect(redoMock).toHaveBeenCalledTimes(1);
    await click(btn('erase-close'));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('撤销/重做不可用时置灰且点击无效', async () => {
    renderDialog({ canUndo: false, canRedo: false });
    expect(btn('erase-undo').disabled).toBe(true);
    expect(btn('erase-redo').disabled).toBe(true);
    await click(btn('erase-undo'));
    expect(undoMock).not.toHaveBeenCalled();
  });
});

describe('IKGOTB 发送门与两条发送路径', () => {
  it('无涂区：发送置灰并悬停说明；清除文字不受涂区影响', async () => {
    renderDialog();
    expect(btn('erase-send-btn').disabled).toBe(true);
    expect(btn('erase-send-btn').getAttribute('title')).toContain('请先用画笔涂抹或框选');
    expect(btn('erase-clear-text').disabled).toBe(false);
    await click(btn('erase-clear-text'));
    expect(sendTextMock).toHaveBeenCalledTimes(1);
  });

  it('源图分辨率缺失（maskSpace=null）：涂抹发送置灰并说明', () => {
    renderDialog({ hasPaint: true, maskSpace: null, ops: OPS_WITH_PAINT });
    expect(btn('erase-send-btn').disabled).toBe(true);
    expect(btn('erase-send-btn').getAttribute('title')).toContain('分辨率未知');
  });

  it('涂抹发送：栅格化遮罩为 PNG File 上抛给 onSendMask（canvas 尺寸=自然分辨率）', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    renderDialog({ hasPaint: true, ops: OPS_WITH_PAINT });
    expect(btn('erase-send-btn').disabled).toBe(false);
    await click(btn('erase-send-btn'));
    expect(sendMaskMock).toHaveBeenCalledTimes(1);
    const [file] = sendMaskMock.mock.calls[0] as [File];
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/png');
    // 栅格化画布尺寸 = 源图自然分辨率（火山接口硬性要求遮罩与原图同分辨率）
    const canvas = getContext.mock.instances[0] as unknown as HTMLCanvasElement;
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(900);
  });

  it('发送中（submitting）：发送与清除文字置灰，工具只读', () => {
    renderDialog({ hasPaint: true, ops: OPS_WITH_PAINT, submitting: true });
    expect(btn('erase-send-btn').disabled).toBe(true);
    expect(btn('erase-clear-text').disabled).toBe(true);
    expect(btn('erase-tool-brush').disabled).toBe(true);
    expect((container!.querySelector('[data-testid="erase-brush-size"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('清除文字返回 true 表示请求已发出（父级据此退出编辑态）', async () => {
    sendTextMock.mockReturnValueOnce(true);
    renderDialog();
    await click(btn('erase-clear-text'));
    expect(sendTextMock).toHaveReturnedWith(true);
  });
});
