import { describe, expect, it } from 'vitest';
import { getPanelLayout } from './layout';

describe('getPanelLayout', () => {
  it('keeps the initial panel inside a narrow viewport', () => {
    expect(
      getPanelLayout({
        pageWidth: 320,
        pageHeight: 520,
        headerHeight: 56,
        panelWidth: 304,
        panelHeight: 600,
        desiredX: 500,
        desiredY: 500,
      }),
    ).toEqual({ x: 8, y: 64, height: 448 });
  });

  it('does not subtract the header twice when clamping floating y', () => {
    expect(
      getPanelLayout({
        pageWidth: 1200,
        pageHeight: 800,
        headerHeight: 64,
        panelWidth: 400,
        panelHeight: 500,
        desiredX: 900,
        desiredY: 700,
      }),
    ).toEqual({ x: 792, y: 292, height: 500 });
  });
});
