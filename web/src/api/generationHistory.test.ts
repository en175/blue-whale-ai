// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchVideoHistory,
  mergeProjectJobs,
  HISTORY_JOBS_PER_PROJECT,
  type HistoryJobEntry,
} from './generationHistory';
import type { JobRecord } from './jobs';

/* IKIZQI：画布外生成历史的数据组装——「拉项目列表 + 逐项目任务查询」拼项目归属，
   合并成一条时间倒序历史流。按真实 fetch 打桩（envelope），验证：
   跨项目合并、时间倒序、单项目失败不阻塞、查询参数携带 type=video。 */

function jobRecord(partial: Partial<JobRecord> & Pick<JobRecord, 'job_id' | 'created_at'>): JobRecord {
  return {
    type: 'video',
    status: 'succeeded',
    progress: 100,
    input: null,
    output_assets: [],
    ...partial,
  };
}

function envelope(data: unknown, code = 200) {
  return new Response(JSON.stringify({ code, msg: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('mergeProjectJobs（纯函数）', () => {
  it('跨项目合并并按创建时间倒序；同刻并列用 job_id 倒序稳定次序', () => {
    const merged = mergeProjectJobs([
      {
        projectId: '55',
        projectName: '项目A',
        records: [
          jobRecord({ job_id: '301', created_at: '2026-09-29T01:00:00Z' }),
          jobRecord({ job_id: '302', created_at: '2026-09-28T00:00:00Z' }),
        ],
      },
      {
        projectId: '91',
        projectName: '项目B',
        records: [
          jobRecord({ job_id: '305', created_at: '2026-09-29T08:00:00Z' }),
          jobRecord({ job_id: '299', created_at: '2026-09-29T08:00:00Z' }),
        ],
      },
    ]);

    expect(merged.map((e) => e.job.job_id)).toEqual(['305', '299', '301', '302']);
    expect(merged.map((e) => e.projectName)).toEqual(['项目B', '项目B', '项目A', '项目A']);
  });

  it('空入参返回空数组（无项目时不渲染任何历史行）', () => {
    expect(mergeProjectJobs([])).toEqual([]);
  });
});

describe('fetchVideoHistory（逐项目查询组装）', () => {
  it('拉项目列表后逐项目查询 type=video 的任务并附带项目名', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === '/api/projects') {
        return envelope([
          { id: 55, name: '短片工坊' },
          { id: 91, name: '旧项目' },
        ]);
      }
      if (href.startsWith('/api/jobs?')) {
        expect(href).toContain('type=video');
        expect(href).toContain(`size=${HISTORY_JOBS_PER_PROJECT}`);
        if (href.includes('projectId=55')) {
          return envelope({
            records: [
              jobRecord({ job_id: '301', created_at: '2026-09-29T01:00:00Z', video_stage: 'sample' }),
            ],
            total: 1,
            size: HISTORY_JOBS_PER_PROJECT,
            current: 1,
          });
        }
        return envelope({
          records: [
            jobRecord({ job_id: '299', created_at: '2026-09-28T00:00:00Z' }),
          ],
          total: 1,
          size: HISTORY_JOBS_PER_PROJECT,
          current: 1,
        });
      }
      throw new Error(`未预期的请求：${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const history = await fetchVideoHistory();

    expect(history.map((e: HistoryJobEntry) => e.job.job_id)).toEqual(['301', '299']);
    expect(history[0]).toMatchObject({ projectId: '55', projectName: '短片工坊' });
    expect(history[1]).toMatchObject({ projectId: '91', projectName: '旧项目' });
  });

  it('单个项目的任务查询失败不阻塞整体（其余项目照常找回）', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === '/api/projects') {
        return envelope([
          { id: 55, name: '正常项目' },
          { id: 91, name: '故障项目' },
        ]);
      }
      if (href.includes('projectId=91')) {
        return new Response(JSON.stringify({ code: 500, msg: '服务暂不可用', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return envelope({
        records: [
          jobRecord({ job_id: '301', created_at: '2026-09-29T01:00:00Z', status: 'failed' }),
        ],
        total: 1,
        size: HISTORY_JOBS_PER_PROJECT,
        current: 1,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const history = await fetchVideoHistory();

    expect(history.map((e) => e.job.job_id)).toEqual(['301']);
    expect(history[0]?.projectName).toBe('正常项目');
  });
});
