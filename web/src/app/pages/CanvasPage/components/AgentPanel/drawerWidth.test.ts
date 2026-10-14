// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  PANEL_WIDTH_STORAGE_KEY,
  clampPanelWidth,
  readPersistedPanelWidth,
} from './drawerWidth';

describe('clampPanelWidth', () => {
  it('常规视口下 468px 原样通过', () => {
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, 1440)).toBe(468);
  });

  it('低于下限 400px 时收回到 400px', () => {
    expect(clampPanelWidth(320, 1440)).toBe(MIN_PANEL_WIDTH);
  });

  it('上限取 720 与 50vw 的较小者：宽视口封顶 720，窄视口按 50vw', () => {
    expect(clampPanelWidth(900, 2000)).toBe(MAX_PANEL_WIDTH);
    expect(clampPanelWidth(900, 1200)).toBe(600);
  });

  it('极窄视口（50vw < 400px）下限让位于可用宽度（视口宽 − 左侧工具栏 60px）', () => {
    expect(clampPanelWidth(468, 500)).toBe(400);
    expect(clampPanelWidth(468, 420)).toBe(360);
    expect(clampPanelWidth(200, 420)).toBe(360);
  });

  it('窗口 resize 后重钳制：同一宽度在新视口下重新收边', () => {
    const wide = clampPanelWidth(700, 2000);
    expect(wide).toBe(700);
    expect(clampPanelWidth(wide, 1000)).toBe(500);
  });
});

describe('readPersistedPanelWidth', () => {
  beforeEach(() => localStorage.clear());

  it('无持久化记录时回退默认宽度 468px', () => {
    expect(readPersistedPanelWidth(1440)).toBe(DEFAULT_PANEL_WIDTH);
  });

  it('读取持久化宽度并回显（经当前视口钳制）', () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, '560');
    expect(readPersistedPanelWidth(1440)).toBe(560);
    expect(readPersistedPanelWidth(1000)).toBe(500);
  });

  it('持久化值损坏（非数字）时回退默认宽度', () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, 'not-a-number');
    expect(readPersistedPanelWidth(1440)).toBe(DEFAULT_PANEL_WIDTH);
  });
});
