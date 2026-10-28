import { initialModel, isolatedModelId, reference, sourceHead } from './fixtures.ts';

type Loader = (file: string) => Promise<Record<string, any>>;
export function createLab(load: Loader) {
  let model: Record<string, any> = structuredClone(initialModel);
  let sequence = 0;
  const models = () => [model, { ...structuredClone(initialModel), id: '2', model_id: isolatedModelId,
    model_label: '对照模型 · 不支持自动', is_default: false,
    features: { ...initialModel.features, task_types: { extend: { allowed_ratios: ['adaptive'] }, omni: {} } },
  }];
  const answer = (data: unknown) => ({ status: 200, body: { code: 200, data, msg: '本地隔离模拟' } });
  return async (method: string, url: string, body?: Record<string, any>) => {
    if (url === '/__ikluvp/reset' && method === 'POST') {
      model = structuredClone(initialModel);
      return answer({ sourceHead });
    }
    if (url === '/__ikluvp/state') return answer({ sourceHead, model, models: models() });
    if (url === '/api/generation/models') return answer(models());
    if (url === '/api/assets') return answer({ records: [reference], total: 1, size: 60, current: 1 });
    if (url === '/api/assets/42') return answer(reference);
    if (url === '/api/projects' && method === 'POST') return answer({ id: 'manual-project', name: '本地验收项目' });
    if (url.endsWith('/generation-jobs/quote')) return answer({ credits: 0, quote_revision: 'manual-no-billing', catalog_version: 1 });
    if (url === '/__ikluvp/model' && method === 'PUT') {
      const { parseModelUpdateBody } = await load('backend/libs/shared/model-capability/constants.ts');
      const result = parseModelUpdateBody(body, model);
      if (!result.ok) return { status: 400, body: { code: 400, msg: result.error } };
      model = { ...model, ...result.value };
      const { toFeatures } = await load('backend/libs/shared/persistence/model-capability-repo.ts');
      model.features = toFeatures(model.features, 'video');
      return answer({ model, parsed: result });
    }
    if (url.endsWith('/generation-jobs') && method === 'POST') {
      const { handleCreateGenerationJob } = await load('backend/libs/shared/generation/handle-create-generation-job.ts');
      const snapshots: unknown[] = [];
      const result = await handleCreateGenerationJob('manual-user', 'manual-project', body, null, {
        projects: { findOwnedById: async () => ({ id: 'manual-project', name: '本地验收项目' }) },
        models: { listEnabledByType: async () => models() },
        command: {
          lookupCreateIdempotency: async () => null,
          createJob: async (input: unknown) => {
            snapshots.push(structuredClone(input));
            return { generation_job_id: `manual-${++sequence}`, cursor: sequence };
          },
        },
        assets: { resolveInputAssets: async (ids: string[]) => ids.filter(id => id === '42').map(() => ({
          id: '42', type: 'video', duration: 6, width: 1280, height: 720, url: reference.url,
        })) },
      });
      return { status: 200, body: { ...result, manual_evidence: { request: body, task_snapshots: snapshots,
        created_count: snapshots.length, persistence: 'memory-stub', upstream: 'NOT_RUN', billing: 'NOT_RUN', sourceHead } } };
    }
    return { status: 404, body: { code: 404, msg: `隔离页面不支持此请求：${method} ${url}` } };
  };
}
