// @vitest-environment jsdom
import { hashKey } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generationQuoteKeys,
  quoteGenerationJob,
  type QuoteJobPayload,
} from './generationQuote';

/* 报价（价格预览）的定价输入里现在含**参考素材**：参考图是定价维度（Seedream 5.0 Pro
   首张免费、第 2 张起 0.02 元/张），所以「参考换了」必须让查询键也换 —— 键不换就吃缓存，
   用户会拿着旧价往下走（预览价与实扣价分叉）。

   这里刻意**不数张数**：载荷就是「哪些参考」，张数由后端 resolveReferenceAssets 数。 */

function imageRef(assetId: string) {
  return { role: 'reference' as const, type: 'image' as const, asset_id: assetId };
}

function payload(overrides: Partial<QuoteJobPayload> = {}): QuoteJobPayload {
  return {
    type: 'image',
    parameters: { model_id: 'doubao-seedream-5-0-pro-260628', size: '2k', aspect_ratio: '1:1' },
    expected_output_count: 1,
    ...overrides,
  };
}

/** 真正参与缓存的不是数组本身而是它的哈希值，所以断言哈希（数组 toEqual 说明不了会不会重查）。 */
function keyHash(projectId: string, p: QuoteJobPayload): string {
  return hashKey(generationQuoteKeys.quote(projectId, p));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generationQuoteKeys.quote', () => {
  it('★ 参考列表一变（加一张/换一张）→ 查询键哈希就变，价格必须重问', () => {
    const one = payload({ references: [imageRef('a')] });
    const two = payload({ references: [imageRef('a'), imageRef('b')] });
    const swapped = payload({ references: [imageRef('c')] });

    expect(keyHash('p1', two)).not.toBe(keyHash('p1', one));
    expect(keyHash('p1', swapped)).not.toBe(keyHash('p1', one));
  });

  it('★ 没有参考 ≠ 有参考：空列表/缺省也要与「有参考」区分开', () => {
    expect(keyHash('p1', payload({ references: [] })))
      .not.toBe(keyHash('p1', payload({ references: [imageRef('a')] })));
    expect(keyHash('p1', payload()))
      .not.toBe(keyHash('p1', payload({ references: [imageRef('a')] })));
  });

  it('内容相同的参考（新数组实例）→ 同一个键，不因重新渲染重复报价', () => {
    const a = payload({ references: [imageRef('a'), imageRef('b')] });
    const b = payload({ references: [imageRef('a'), imageRef('b')] });

    expect(keyHash('p1', b)).toBe(keyHash('p1', a));
  });

  it('项目不同 → 键不同（价是挂在项目下的）', () => {
    const p = payload({ references: [imageRef('a')] });

    expect(keyHash('p2', p)).not.toBe(keyHash('p1', p));
  });
});

describe('quoteGenerationJob', () => {
  it('参考素材原样进请求体（形态与创建任务一致）', async () => {
    const references = [
      { role: 'reference' as const, type: 'image' as const, asset_id: 'a' },
      { role: 'reference' as const, type: 'image' as const, asset_id: 'b' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: null, data: { credits: 42 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await quoteGenerationJob('p1', payload({ references }));

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/p1/generation-jobs/quote');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'image',
      parameters: { model_id: 'doubao-seedream-5-0-pro-260628', size: '2k', aspect_ratio: '1:1' },
      expected_output_count: 1,
      references,
    });
  });
});

/* IKIZQB：报价响应即契约 StageQuoteView（credits + quote_revision 同出同缺），
   sample_mode 是定价输入之一（键随开关变化，不互吃缓存）。 */
describe('样片报价（IKIZQB）', () => {
  it('响应透传 quote_revision（提交确认字段的来源）', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 200, msg: null, data: { credits: 60, quote_revision: 'rev-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })));
    vi.stubGlobal('fetch', fetchMock);

    const data = await quoteGenerationJob('p1', payload({ type: 'video' }));

    expect(data).toEqual({ credits: 60, quote_revision: 'rev-1' });
  });

  it('sample_mode 进定价输入 → 查询键不同（样片价与普通价不互吃缓存）', () => {
    const base = { type: 'video' as const, parameters: { model_id: 'seedance-25', resolution: '1080p' } };
    const normal = payload(base);
    const sample = payload({
      ...base,
      parameters: { model_id: 'seedance-25', resolution: '480p', sample_mode: true },
    });

    expect(keyHash('p1', sample)).not.toBe(keyHash('p1', normal));
  });
});
