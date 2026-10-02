import { createCropSession } from '../cropSession';
import { createAudioTrimSession } from '../audioToolSessions';
import type { createToolSessionRuntime } from '../toolSessionRuntime';
import type { ToolSessionDeps } from '../toolSessionCoordinator';

/** 身份测试仍经过真实定义；完整跨工具矩阵由 canvasToolSessions.test 守护。 */
export function openOtherTool(
  runtime: ReturnType<typeof createToolSessionRuntime>,
  deps: ToolSessionDeps,
  crop = true,
) {
  const host = {
    getProjectId: () => 'p1',
    getSourceNode: (id: string) => ({
      id,
      type: 'mediaNode',
      position: { x: 0, y: 0 },
      data: { duration: 30, width: 1024, height: 768 },
    }),
    warn() {},
    error() {},
  };
  if (crop)
    return runtime
      .register(
        createCropSession(() => ({
          ...host,
          uploadFile: async () => {
            throw new Error('unused');
          },
          handoff() {},
        })),
      )
      .open('other', deps);
  return runtime
    .register(
      createAudioTrimSession(() => ({
        ...host,
        createTask: async () => ({ job_id: 'unused' }),
        handoff: async () => {},
      })),
    )
    .open('other', deps);
}
