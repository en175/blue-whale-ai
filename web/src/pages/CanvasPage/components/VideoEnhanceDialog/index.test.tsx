// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoEnhanceDialog from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let sendMock: ReturnType<typeof vi.fn>;
let paramsChangeMock: ReturnType<typeof vi.fn>;
let closeMock: ReturnType<typeof vi.fn>;

function renderPanel(props: Partial<Parameters<typeof VideoEnhanceDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(VideoEnhanceDialog, {
        onClose: closeMock,
        onSend: sendMock,
        onParamsChange: paramsChangeMock,
        ...props,
      } as Parameters<typeof VideoEnhanceDialog>[0]),
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
  sendMock = vi.fn(() => false);
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

describe('IKH3VG 面板三档渲染与默认值', () => {
  it('默认 1080P（契约默认档单源），三档齐备', () => {
    renderPanel();
    expect(btn('video-enhance-resolution-1080p').className).toMatch(/Active/);
    expect(btn('video-enhance-resolution-2k')).toBeTruthy();
    expect(btn('video-enhance-resolution-4k')).toBeTruthy();
    expect(container!.textContent).toContain('HD 高清');
    expect(container!.textContent).not.toContain('供应商');
    expect(container!.textContent).not.toContain('模型');
    expect(container!.textContent).not.toContain('高级参数');
  });

  it('切换三档分段即时生效：选中态切换并回传 onParamsChange（写卡持久化）', async () => {
    renderPanel();
    await click(btn('video-enhance-resolution-4k'));
    expect(btn('video-enhance-resolution-4k').className).toMatch(/Active/);
    expect(btn('video-enhance-resolution-1080p').className).not.toMatch(/Active/);
    expect(paramsChangeMock).toHaveBeenCalledWith('4k');
    await click(btn('video-enhance-resolution-2k'));
    expect(btn('video-enhance-resolution-2k').className).toMatch(/Active/);
    expect(paramsChangeMock).toHaveBeenLastCalledWith('2k');
  });

  it('回填 initialResolution（lastParams 恢复；关闭再开/重新编辑同源）', () => {
    renderPanel({ initialResolution: '4k' });
    expect(btn('video-enhance-resolution-4k').className).toMatch(/Active/);
    expect(btn('video-enhance-resolution-1080p').className).not.toMatch(/Active/);
  });

  it('重复点击当前档不回传 onParamsChange', async () => {
    renderPanel();
    await click(btn('video-enhance-resolution-1080p'));
    expect(paramsChangeMock).not.toHaveBeenCalled();
  });
});

describe('IKH3VG 本期免费与发送钮', () => {
  it('免费文案呈现；发送钮悬停「最高可至 4K」', () => {
    renderPanel();
    expect(container!.textContent).toContain('本期免费');
    expect(btn('video-enhance-send-btn').getAttribute('title')).toBe('最高可至 4K');
  });

  it('发送不接真调用（本票占位）：onSend 收到当前分辨率，返回 false 面板保持打开', async () => {
    renderPanel();
    await click(btn('video-enhance-resolution-2k'));
    await click(btn('video-enhance-send-btn'));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith('2k');
    expect(btn('video-enhance-send-btn')).toBeTruthy();
  });

  it('点关闭钮派发 onClose（关闭不丢参数：写卡在切换时已完成）', async () => {
    renderPanel();
    await click(btn('video-enhance-close-btn'));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

describe('IKH3VG 只读态（generating/submitting 冻结）', () => {
  it('生成中：三档与发送钮冻结，只读提示可见，悬停切换为只读原因', () => {
    renderPanel({ generating: true, initialResolution: '4k' });
    expect(container!.textContent).toContain('生成中，参数只读');
    expect(btn('video-enhance-resolution-1080p').disabled).toBe(true);
    expect(btn('video-enhance-resolution-4k').disabled).toBe(true);
    expect(btn('video-enhance-send-btn').disabled).toBe(true);
    expect(btn('video-enhance-send-btn').getAttribute('title')).toContain('生成中，参数只读');
  });

  it('提交中：同样只读冻结（口径同图片面板 submitting）', () => {
    renderPanel({ submitting: true });
    expect(container!.textContent).toContain('正在保存并提交，参数只读');
    expect(btn('video-enhance-send-btn').disabled).toBe(true);
  });
});
