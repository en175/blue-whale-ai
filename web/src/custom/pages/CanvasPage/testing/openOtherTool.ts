import { createCropSession } from '../tools/image/cropSession';
import { createAudioTrimSession } from '../tools/audio/audioToolSessions';
import type { createToolSessionRuntime } from '../tool-runtime/toolSessionRuntime';
import type { ToolSessionDeps } from '../tool-runtime/toolSessionCoordinator';

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
        startTask: () => true,
      })),
    )
    .open('other', deps);
}
