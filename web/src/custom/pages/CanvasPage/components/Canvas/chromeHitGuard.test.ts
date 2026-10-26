// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canvasChromeAtPoint, swallowStolenCanvasChromeHit } from './chromeHitGuard';

const POINT = { x: 120, y: 40 };

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect;
}

function stubRect(el: HTMLElement, rect: DOMRect) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect);
}

function at(ms: number) {
  vi.spyOn(performance, 'now').mockReturnValue(ms);
}

function gesture(type: string, target: EventTarget) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: POINT.x });
  Object.defineProperty(event, 'clientY', { value: POINT.y });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function mountChromeAndCanvas() {
  const chrome = document.createElement('div');
  chrome.dataset.canvasChrome = '';
  const addToChat = document.createElement('button');
  addToChat.textContent = '添加到对话';
  const onAddToChat = vi.fn();
  addToChat.addEventListener('click', onAddToChat);
  chrome.append(addToChat);
  const canvas = document.createElement('div');
  document.body.append(chrome, canvas);
  const chromeBox = box(80, 20, 160, 40);
  stubRect(chrome, chromeBox);
  stubRect(addToChat, chromeBox);
  stubRect(canvas, box(0, 0, 800, 600));
  return { chrome, addToChat, canvas, onAddToChat };
}

beforeEach(() => {
  at(10_000);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('点在浮层上：不把事件转发给底下的添加到对话', () => {
  const { onAddToChat } = mountChromeAndCanvas();
  const overlay = document.createElement('div');
  overlay.dataset.canvasOverlay = '';
  const rebind = document.createElement('button');
  rebind.textContent = '重新绑定';
  overlay.append(rebind);
  document.body.append(overlay);
  stubRect(overlay, box(80, 20, 160, 80));
  stubRect(rebind, box(80, 20, 160, 32));

  expect(swallowStolenCanvasChromeHit(gesture('pointerdown', rebind))).toBe(false);
  expect(swallowStolenCanvasChromeHit(gesture('click', rebind))).toBe(false);
  expect(onAddToChat).not.toHaveBeenCalled();
});

it('浮层在 pointerdown 卸掉后，同一次 click 也不转发到底下的添加到对话', () => {
  const { canvas, onAddToChat } = mountChromeAndCanvas();
  const overlay = document.createElement('div');
  overlay.dataset.canvasOverlay = '';
  const rebind = document.createElement('button');
  overlay.append(rebind);
  document.body.append(overlay);

  at(100);
  swallowStolenCanvasChromeHit(gesture('pointerdown', rebind));
  overlay.remove();
  at(150);
  expect(swallowStolenCanvasChromeHit(gesture('click', canvas))).toBe(false);
  expect(onAddToChat).not.toHaveBeenCalled();
});

it('没有浮层时，叠在工具条上的画布点击仍转发给添加到对话', () => {
  const { canvas, onAddToChat } = mountChromeAndCanvas();
  expect(swallowStolenCanvasChromeHit(gesture('click', canvas))).toBe(true);
  expect(onAddToChat).toHaveBeenCalledTimes(1);
});

it('钉屏幕浮层领地内的 chrome 根不算画布 chrome（否则光标移入触发自卸载闪烁）', () => {
  const territory = document.createElement('div');
  territory.dataset.genPanelTerritory = '';
  territory.dataset.canvasChrome = '';
  document.body.append(territory);
  stubRect(territory, box(80, 20, 160, 40));
  expect(canvasChromeAtPoint(POINT.x, POINT.y)).toBeNull();
});

it('对照：非领地 chrome 根仍然命中', () => {
  const chrome = document.createElement('div');
  chrome.dataset.canvasChrome = '';
  document.body.append(chrome);
  stubRect(chrome, box(80, 20, 160, 40));
  expect(canvasChromeAtPoint(POINT.x, POINT.y)).toBe(chrome);
});
