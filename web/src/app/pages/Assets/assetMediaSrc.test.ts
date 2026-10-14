import { describe, expect, it } from 'vitest';
import { assetMediaDisplay } from './assetMediaSrc';

const SIGNED_SEEDREAM =
  'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-5-0/example.jpeg' +
  '?X-Tos-Algorithm=TOS4-HMAC-SHA256' +
  '&X-Tos-Credential=AKEXAMPLE%2F20260830%2Fcn-beijing%2Ftos%2Frequest' +
  '&X-Tos-Date=20260830T052302Z&X-Tos-Expires=86400' +
  '&X-Tos-Signature=93fa895f142e8686255cc43dd133c24b3670a02a18b3c759716ec40bb0c95365' +
  '&X-Tos-SignedHeaders=host';

const PUBLIC_TOS =
  'https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/8/image/abc.jpg';

describe('assetMediaDisplay', () => {
  it('keeps TOS signed query intact and never appends _reload', () => {
    const { src } = assetMediaDisplay(SIGNED_SEEDREAM, 0);
    expect(src).toBe(SIGNED_SEEDREAM);
    expect(src).not.toMatch(/[?&]_reload=/);
  });

  it('does not append query to public TOS urls on first load or retry', () => {
    expect(assetMediaDisplay(PUBLIC_TOS, 0).src).toBe(PUBLIC_TOS);
    expect(assetMediaDisplay(PUBLIC_TOS, 1).src).toBe(PUBLIC_TOS);
  });

  it('changes node key on retry without mutating src', () => {
    const first = assetMediaDisplay(SIGNED_SEEDREAM, 0);
    const retry = assetMediaDisplay(SIGNED_SEEDREAM, 1);
    expect(retry.src).toBe(first.src);
    expect(retry.nodeKey).not.toBe(first.nodeKey);
  });
});
