// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import {
  batchDeleteProjects,
  fetchProjectPage,
  fetchProjects,
  projectPageQueryOptions,
} from './projects';

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

const project = {
  id: 'project-1',
  name: '分镜草稿',
  previews: [],
  created_at: '2026-09-04T00:00:00.000Z',
  last_opened_at: null,
  last_edited_at: '2026-09-04T00:00:00.000Z',
  pinned_at: null,
};

function apiResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, msg: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('projects API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  it('keeps the Canvas hydration list request unpaginated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse([project]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchProjects();

    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.any(Object));
  });

  it('requests a silent, explicitly sized project page for the card list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse({ records: [project], total: 31, size: 30, current: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchProjectPage(2, 30);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects?page=2&size=30',
      expect.any(Object),
    );
  });

  it('keeps project page failures silent so the page can render its inline loading error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 500, msg: '项目服务暂不可用', data: null }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(fetchProjectPage(1, 30)).rejects.toMatchObject({
      message: '项目服务暂不可用',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('submits a batch delete request with the selected project ids', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(apiResponse({ succeeded: ['project-1', 'project-2'], failed: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await batchDeleteProjects(['project-1', 'project-2']);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/batch-delete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['project-1', 'project-2'] }),
      }),
    );
  });

  it('advances project pages only while unique loaded records are below the total', () => {
    const query = projectPageQueryOptions(30);
    const firstPage = { records: [project], total: 2, size: 30, current: 1 };
    const lastPage = {
      records: [{ ...project, id: 'project-2' }],
      total: 2,
      size: 30,
      current: 2,
    };

    expect(query.getNextPageParam(firstPage, [firstPage], 1, [1])).toBe(2);
    expect(query.getNextPageParam(lastPage, [firstPage, lastPage], 2, [1, 2])).toBeUndefined();
  });
});
