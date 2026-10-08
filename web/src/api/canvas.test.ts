// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import { fetchCanvasDoc, saveCanvasDoc, serializeEdges } from './canvas';

function okResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, msg: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('serializeEdges', () => {
  it('保留持久形状 {id, source, target, data?}，剥离渲染细节；data 承载关系属性（IKDMQS refRole）', () => {
    const edges = [
      {
        id: 'e1',
        source: 'text-1',
        target: 'media-1',
        type: 'custom',
        style: { stroke: '#444' },
        selected: true,
      },
      {
        id: 'e2',
        source: 'img-1',
        target: 'video-draft-1',
        type: 'custom',
        style: { stroke: '#444' },
        data: { refRole: 'first' },
      },
    ] as unknown as Edge[];
    expect(JSON.parse(serializeEdges(edges))).toEqual([
      { id: 'e1', source: 'text-1', target: 'media-1' },
      { id: 'e2', source: 'img-1', target: 'video-draft-1', data: { refRole: 'first' } },
    ]);
  });

  it('空数组序列化为 []', () => {
    expect(serializeEdges([])).toBe('[]');
  });
});

describe('fetchCanvasDoc', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('水合后端返回的 edges 数组', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          id: 9,
          project_id: 7,
          version: 3,
          viewport: '{"x":1,"y":2,"zoom":1.1}',
          nodes: '[]',
          edges: '[{"id":"e1","source":"text-1","target":"media-1"}]',
        }),
      ),
    );

    const doc = await fetchCanvasDoc('p-edges');
    expect(doc.edges).toEqual([{ id: 'e1', source: 'text-1', target: 'media-1' }]);
  });

  it('旧数据缺省 edges 视为空数组', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          id: 9,
          project_id: 7,
          version: 3,
          viewport: null,
          nodes: null,
        }),
      ),
    );

    const doc = await fetchCanvasDoc('p-legacy');
    expect(doc.edges).toEqual([]);
  });
});

describe('saveCanvasDoc', () => {
  afterEach(() => vi.unstubAllGlobals());

  function conflictResponse(version: number) {
    return new Response(JSON.stringify({ code: 412, msg: 'Canvas 版本冲突', data: { version } }), {
      status: 412,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('PUT body 携带与 nodes 同构的 edges JSON 字符串，If-Match 头保持', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ id: 9, project_id: 7, version: 4, viewport: '{}', nodes: '[]', edges: '[]' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await saveCanvasDoc(
      'p1',
      {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [
          { id: 'e1', source: 'text-1', target: 'media-1', type: 'custom', style: { stroke: '#444' } } as unknown as Edge,
        ],
      },
      3,
    );

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/canvases/p1');
    expect(init.method).toBe('PUT');
    expect((init.headers as Headers).get('If-Match')).toBe('"3"');
    const body = JSON.parse(init.body as string);
    expect(body.edges).toBe('[{"id":"e1","source":"text-1","target":"media-1"}]');
    expect(body.nodes).toBe('[]');
    expect(JSON.parse(body.viewport)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect('confirmEmpty' in body).toBe(false);
  });

  it('confirmEmpty=true 时空保存携带显式确认字段（IKIIWN），否则不带', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      okResponse({ id: 9, project_id: 7, version: 5, viewport: '{}', nodes: '[]', edges: '[]' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await saveCanvasDoc('p1', { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], confirmEmpty: true }, 4);
    await saveCanvasDoc('p1', { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }, 5);

    const confirmed = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const unconfirmed = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(confirmed.confirmEmpty).toBe(true);
    expect('confirmEmpty' in unconfirmed).toBe(false);
  });

  it('IKILUE：confirmEmpty 空保存收到 412 冲突信封后不自动重发——只发一次 PUT，错误原样抛给调用方', async () => {
    const fetchMock = vi.fn().mockResolvedValue(conflictResponse(8));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      saveCanvasDoc('p1', { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], confirmEmpty: true }, 3),
    ).rejects.toMatchObject({ status: 412, code: 412, message: 'Canvas 版本冲突', data: { version: 8 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect((init.headers as Headers).get('If-Match')).toBe('"3"');
  });

  it('IKILUE 对照：非 confirmEmpty 保存收到同样 412 仍按既有策略用信封新版本号重试', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(conflictResponse(8))
      .mockResolvedValueOnce(okResponse({ id: 9, project_id: 7, version: 9, viewport: '{}', nodes: '[]', edges: '[]' }));
    vi.stubGlobal('fetch', fetchMock);

    const saved = await saveCanvasDoc(
      'p1',
      {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{ id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { text: 'a' } }],
        edges: [],
      },
      3,
    );

    expect(saved.version).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1]! as [string, RequestInit];
    expect((retryInit.headers as Headers).get('If-Match')).toBe('"8"');
  });
});
