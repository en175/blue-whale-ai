import { describe, expect, it } from 'vitest';
import { mediaContentBox } from './mediaContentSize';

function expectBox(
  input: Parameters<typeof mediaContentBox>[0],
  expectedWidth: number,
  expectedHeight: number,
) {
  const box = mediaContentBox(input);
  expect(box.width).toBeCloseTo(expectedWidth, 1);
  expect(box.height).toBeCloseTo(expectedHeight, 1);
}

describe('mediaContentBox', () => {
  it('matches the ticket ratio table (real dims)', () => {
    expectBox({ width: 3, height: 4 }, 280, 373.3);
    expectBox({ width: 4, height: 3 }, 373.3, 280);
    expectBox({ width: 16, height: 9 }, 497.8, 280);
    expectBox({ width: 9, height: 16 }, 280, 497.8);
    expectBox({ width: 100, height: 100 }, 280, 280);
    expectBox({ width: 1, height: 10 }, 84, 840);
    expectBox({ width: 10, height: 1 }, 840, 84);
  });

  it('keeps real photo/video resolutions proportional', () => {
    expectBox({ width: 1600, height: 900 }, 497.8, 280);
    expectBox({ width: 900, height: 1600 }, 280, 497.8);
    expectBox({ width: 800, height: 800 }, 280, 280);
  });

  it('scales small originals up to the short side', () => {
    expectBox({ width: 100, height: 50 }, 560, 280);
    expectBox({ width: 50, height: 100 }, 280, 560);
  });

  it('falls back to 280×280 when dims are unknown', () => {
    expectBox({}, 280, 280);
    expectBox({ width: 0, height: 0 }, 280, 280);
    expectBox({ width: 100 }, 280, 280);
  });

  it('uses the target ratio only when real dims are missing', () => {
    expectBox({ ratio: '16:9' }, 497.8, 280);
    expectBox({ ratio: '9:16' }, 280, 497.8);
    expectBox({ width: 100, height: 100, ratio: '16:9' }, 280, 280);
  });

  it('treats unparseable ratios as unknown', () => {
    expectBox({ ratio: 'adaptive' }, 280, 280);
    expectBox({ ratio: '16-9' }, 280, 280);
    expectBox({ ratio: '0:9' }, 280, 280);
    expectBox({ ratio: '' }, 280, 280);
  });

  it('keeps audio landscape regardless of dims or target ratio (IKH8PU)', () => {
    expectBox({ mediaType: 'audio' }, 480, 240);
    expectBox({ mediaType: 'audio', width: 1600, height: 900 }, 480, 240);
    expectBox({ mediaType: 'audio', ratio: '16:9' }, 480, 240);
    expectBox({ mediaType: 'audio', width: 100, height: 1000, ratio: '9:16' }, 480, 240);
  });

  it('still scales image/video when mediaType is given', () => {
    expectBox({ mediaType: 'image', width: 1600, height: 900 }, 497.8, 280);
    expectBox({ mediaType: 'video', width: 900, height: 1600 }, 280, 497.8);
    expectBox({ mediaType: 'video', ratio: '16:9' }, 497.8, 280);
  });
});
