import { describe, expect, it } from 'vitest';
import {
  CANVAS_QUERY_KEY,
  canvasLocationSearch,
  findLastOpenedProjectId,
  findLatestCreatedProjectId,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
  shouldReturnToProjectsAfterDelete,
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

  it('falls back to the last opened canvas when the query is missing or unknown', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b', 'c'], 'b')).toBe('b');
    expect(pickCanvasIdAfterLoad('gone', ['a', 'b', 'c'], 'b')).toBe('b');
  });

  it('falls back to the first canvas when the last opened canvas is gone', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b'], 'deleted')).toBe('a');
  });

  it('ignores an empty last opened id', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b'], '')).toBe('a');
  });

  it('keeps the existing two-level behaviour when no last opened id is given', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b'])).toBe('a');
    expect(pickCanvasIdAfterLoad('gone', ['a', 'b'])).toBe('a');
    expect(pickCanvasIdAfterLoad('', [])).toBe('');
  });

  it('falls back to the latest created canvas when neither query nor last opened matches', () => {
    expect(pickCanvasIdAfterLoad('', ['pinned-old', 'newest', 'mid'], '', 'newest')).toBe('newest');
    expect(pickCanvasIdAfterLoad('gone', ['pinned-old', 'newest', 'mid'], '', 'newest')).toBe('newest');
  });

  it('prefers the last opened canvas over the latest created one', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b', 'c'], 'a', 'c')).toBe('a');
  });

  it('falls back to the first canvas when the latest created id is not in the list', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b'], '', 'deleted')).toBe('a');
  });

  it('ignores an empty latest created id', () => {
    expect(pickCanvasIdAfterLoad('', ['a', 'b'], '', '')).toBe('a');
  });
});

describe('findLatestCreatedProjectId', () => {
  it('returns the most recently created project id regardless of order', () => {
    expect(
      findLatestCreatedProjectId([
        { id: 'pinned', created_at: '2026-09-01T00:00:00Z' },
        { id: 'newest', created_at: '2026-09-20T00:00:00Z' },
        { id: 'mid', created_at: '2026-09-10T00:00:00Z' },
      ]),
    ).toBe('newest');
  });

  it('returns empty string when every created_at is null', () => {
    expect(
      findLatestCreatedProjectId([
        { id: 'a', created_at: null },
        { id: 'b', created_at: null },
      ]),
    ).toBe('');
  });

  it('returns the single project id and empty string for an empty list', () => {
    expect(findLatestCreatedProjectId([{ id: 7, created_at: '2026-09-01T00:00:00Z' }])).toBe('7');
    expect(findLatestCreatedProjectId([])).toBe('');
  });
});

describe('findLastOpenedProjectId', () => {
  it('returns empty string when no project was ever opened', () => {
    expect(
      findLastOpenedProjectId([
        { id: 'a', last_opened_at: null },
        { id: 'b', last_opened_at: null },
      ]),
    ).toBe('');
  });

  it('returns the single opened project id', () => {
    expect(findLastOpenedProjectId([{ id: 'a', last_opened_at: '2026-09-01T00:00:00Z' }])).toBe('a');
  });

  it('returns the most recently opened project id', () => {
    expect(
      findLastOpenedProjectId([
        { id: 1, last_opened_at: '2026-09-01T00:00:00Z' },
        { id: 'b', last_opened_at: '2026-09-10T00:00:00Z' },
        { id: 'c', last_opened_at: '2026-09-05T00:00:00Z' },
      ]),
    ).toBe('b');
  });

  it('returns empty string for an empty list', () => {
    expect(findLastOpenedProjectId([])).toBe('');
  });
});

describe('shouldReturnToProjectsAfterDelete', () => {
  it('returns to the project list only after deleting the current canvas', () => {
    expect(shouldReturnToProjectsAfterDelete('mid', 'mid')).toBe(true);
    expect(shouldReturnToProjectsAfterDelete('mid', 'oldest')).toBe(false);
  });
});
