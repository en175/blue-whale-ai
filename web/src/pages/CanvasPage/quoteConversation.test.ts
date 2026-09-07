import { describe, expect, it } from 'vitest';
import { extractTextNodeText, quoteChipLabel, textQuoteBlock } from './quoteConversation';

describe('extractTextNodeText', () => {
  it('uses the authoritative plain text verbatim, preserving newlines', () => {
    expect(extractTextNodeText({ text: '第一行\n第二行\n\n第四行', html: '<p>旧画面</p>' })).toBe('第一行\n第二行\n\n第四行');
  });

  it('extracts legacy html with line boundaries restored as newlines', () => {
    expect(extractTextNodeText({ html: '<p>第一段<br>换行</p><p>第二段</p>' })).toBe('第一段\n换行\n第二段');
  });

  it('decodes basic entities and returns empty for empty nodes', () => {
    expect(extractTextNodeText({ html: '<p>&lt;光影&gt; &amp; 细节</p>' })).toBe('<光影> & 细节');
    expect(extractTextNodeText({})).toBe('');
    expect(extractTextNodeText({ text: '   ' })).toBe('');
  });

  it('keeps consecutive blank lines from legacy html instead of compressing them', () => {
    expect(extractTextNodeText({ html: '<p>一</p><p></p><p></p><p>二</p>' })).toBe('一\n\n\n二');
  });
});

describe('quoteChipLabel', () => {
  it('prefers the node title and falls back to a compact text prefix', () => {
    expect(quoteChipLabel('雪夜', '无论多长都不进标签'.repeat(20))).toBe('雪夜');
    expect(quoteChipLabel('', '短正文')).toBe('短正文');
    expect(quoteChipLabel('', '1234567890abcdef')).toBe('1234567890…');
    expect(quoteChipLabel('', '1234567890')).toBe('1234567890');
  });
});

describe('textQuoteBlock', () => {
  it('carries the frozen snapshot identity, full text and preview source', () => {
    const block = textQuoteBlock({
      nodeId: 'text-1',
      chipId: '123',
      label: '雪夜',
      quote: {
        quoteId: '42',
        nodeId: 'text-1',
        title: '雪夜',
        text: '正文\n换行保留',
        source: { sessionId: 's-1', revisionId: 'r-1', shotNo: 2 },
        quotedAt: '2026-09-07T00:00:00.000Z',
      },
    });
    expect(block).toMatchObject({
      node_id: 'text-1',
      chip_id: '123',
      display_label: '雪夜',
      quote_id: '42',
      resource_id: '42',
      resource_text: '正文\n换行保留',
      prompt_source: { sessionId: 's-1', revisionId: 'r-1', shotNo: 2 },
    });
  });

  it('omits prompt_source for plain text without a preview source', () => {
    const block = textQuoteBlock({
      nodeId: 'text-2',
      chipId: '9',
      label: '普通文本',
      quote: { quoteId: '7', nodeId: 'text-2', title: '', text: '普通正文', source: null, quotedAt: '2026-09-07T00:00:00.000Z' },
    });
    expect(block.prompt_source).toBeUndefined();
    expect(block.resource_text).toBe('普通正文');
  });
});
