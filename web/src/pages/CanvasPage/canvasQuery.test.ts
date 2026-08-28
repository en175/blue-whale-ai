import { describe, expect, it } from 'vitest';
import {
  CANVAS_QUERY_KEY,
  canvasLocationSearch,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
  withCanvasId,
} from './canvasQuery';

describe('readCanvasIdFromSearch', () => {
  it('reads the project query as the canvas id', () => {
    expect(readCanvasIdFromSearch(new URLSearchParams('project=42'))).toBe('42');
  });

  it('returns empty string when the canvas query is missing', () => {
    expect(readCanvasIdFromSearch(new URLSearchParams('foo=1'))).toBe('');
  });

  it('trims whitespace around the canvas id', () => {
    expect(readCanvasIdFromSearch(new URLSearchParams('project=%2042%20'))).toBe('42');
  });
});

describe('withCanvasId / canvasLocationSearch', () => {
  it('writes the canvas id and preserves unrelated query keys', () => {
    const next = withCanvasId(new URLSearchParams('tab=agent'), '99');
    expect(next.get(CANVAS_QUERY_KEY)).toBe('99');
    expect(next.get('tab')).toBe('agent');
    expect(canvasLocationSearch(new URLSearchParams('tab=agent'), '99')).toBe('?tab=agent&project=99');
  });

  it('replaces an existing canvas id without duplicating the key', () => {
    const next = withCanvasId(new URLSearchParams('project=1'), '2');
    expect(next.getAll(CANVAS_QUERY_KEY)).toEqual(['2']);
    expect(canvasLocationSearch(new URLSearchParams('project=1'), '2')).toBe('?project=2');
  });

  it('omits the canvas key when the id is empty', () => {
    expect(canvasLocationSearch(new URLSearchParams('project=1&tab=agent'), '')).toBe('?tab=agent');
    expect(canvasLocationSearch(new URLSearchParams('project=1'), '   ')).toBe('');
  });
});

describe('pickCanvasIdAfterLoad', () => {
  it('keeps the query id when it is still in the canvas list', () => {
    expect(pickCanvasIdAfterLoad('b', ['a', 'b', 'c'])).toBe('b');
  });

  it('falls back to the first canvas when the query is missing or unknown', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b'])).toBe('a');
    expect(pickCanvasIdAfterLoad('gone', ['a', 'b'])).toBe('a');
  });

  it('returns empty string when there are no canvases', () => {
    expect(pickCanvasIdAfterLoad('a', [])).toBe('');
  });
});
