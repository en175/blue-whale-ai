/* ============================================
 * generationHistory 接口：画布外生成历史（IKIZQI）
 *
 * ⚠️ **独立于 jobs.ts**：那里的老测试对 `@/api/jobs` 做部分 mock，新加导出会连坐一片
 *    测试文件（先例见 generationQuote.ts 头注）。历史查询工厂住自己的模块。
 *
 * 数据形状：`GET /api/jobs` 的用户端列表**不带 project_id**（列表投影只有阶段六件套，
 * 见 backend job-repo JobListItem），而历史必须显示项目归属（父规格 IKIZPZ「历史与
 * 资产」：包含项目、阶段、状态、来源和费用）。所以归属靠「拉本人项目列表 + 逐项目
 * 查询」拼出来——每个项目的记录天然带项目名。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { fetchProjects } from './projects';
import { fetchJobs, type JobRecord } from './jobs';

/** 历史行 = 任务记录 + 项目归属（项目 id/名称由逐项目查询附带）。 */
export interface HistoryJobEntry {
  job: JobRecord;
  projectId: string;
  projectName: string;
}

/** 每个项目取的视频任务数上限。
 *  ponytail: 单页 size 封顶，超出即截断；真实用户单项目视频任务超此数前，后端列表
 *  投影 project_id 落地后应改为一次跨项目汇总查询（IKIZQI 汇报的后续票注意点）。 */
export const HISTORY_JOBS_PER_PROJECT = 100;

/** 合并各项目记录为一条时间倒序的历史流（纯函数，测试直测）。
 *  每项目内部已按 gmt_create 倒序，这里全局重排；同刻并列用 job_id 倒序稳定次序。 */
export function mergeProjectJobs(
  groups: Array<{ projectId: string; projectName: string; records: JobRecord[] }>,
): HistoryJobEntry[] {
  return groups
    .flatMap((group) =>
      group.records.map((job) => ({
        job,
        projectId: group.projectId,
        projectName: group.projectName,
      })),
    )
    .sort((a, b) => {
      const byTime = Date.parse(b.job.created_at || '') - Date.parse(a.job.created_at || '');
      if (byTime !== 0) return byTime;
      return Number(b.job.job_id) - Number(a.job.job_id);
    });
}

/** 拉取本人跨项目视频生成历史：项目列表 + 逐项目任务查询（并行、单项目失败不阻塞整体）。
 *  失败/已删除项目的任务会缺席——项目删除时任务行仍在库（is_delete=false），但列表
 *  投影无 project_id，前端无从归属；显示它们需后端后续投影（见上 ponytail 注）。 */
export async function fetchVideoHistory(): Promise<HistoryJobEntry[]> {
  const projects = await fetchProjects();
  const settled = await Promise.allSettled(
    projects.map(async (project) => ({
      projectId: String(project.id),
      projectName: project.name,
      records: (
        await fetchJobs(
          { projectId: String(project.id), type: 'video', size: HISTORY_JOBS_PER_PROJECT },
          { silent: true },
        )
      ).records,
    })),
  );
  return mergeProjectJobs(
    settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
  );
}

export const generationHistoryKeys = {
  all: ['generation-history'] as const,
  video: () => [...generationHistoryKeys.all, 'video'] as const,
};

/** 历史页查询配置：跨页面/刷新找回都重查服务端持久记录（staleTime 走全局 30s）。 */
export function videoHistoryOptions() {
  return queryOptions({
    queryKey: generationHistoryKeys.video(),
    queryFn: () => fetchVideoHistory(),
  });
}
