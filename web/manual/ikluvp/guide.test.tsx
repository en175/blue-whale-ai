// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';

it('验收台准备素材、记录人工结论并导出未验项', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, beginPath() {}, arc() {}, fill() {}, fillText() {} } as any);
  HTMLCanvasElement.prototype.captureStream = () => ({ getTracks: () => [{ stop() {} }] }) as any;
  vi.stubGlobal('MediaRecorder', class {
    mimeType = 'video/webm';
    onstop?: () => void;
    ondataavailable?: (event: { data: Blob }) => void;
    start() { this.ondataavailable?.({ data: new Blob(['local-test']) }); }
    stop() { this.onstop?.(); }
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 200 }), { status: 200 })));
  URL.createObjectURL = vi.fn(() => 'blob:report'); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  let module: typeof import('./guide');
  await act(async () => { module = await import('./guide'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(document.querySelector('iframe')?.getAttribute('src')).toContain('case=C1');
  const click = async (label: string) => { await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === label)!.click(); }); };
  await click('通过'); await click('进入下一组');
  expect(document.querySelector('iframe')?.getAttribute('src')).toContain('case=C2');
  await click('导出当前报告');
  expect(document.body.textContent).toContain('把下面摘要复制回聊天');
  expect([...document.querySelectorAll('textarea')].at(-1)?.value).toContain('1/8 组已记录，1 组通过');
  expect([...document.querySelectorAll('textarea')].at(-1)?.value).toContain('C2 指定 4、10、30 秒：待测试');
  await act(async () => module!.guideRoot.unmount()); vi.useRealTimers();
});
