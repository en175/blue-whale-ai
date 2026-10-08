import type { ComponentProps } from 'react';
import BottomDialog from './components/BottomDialog';
import type { createVideoGenerationDock, VideoDockPatch, VideoDockSend } from './videoGenerationDock';

type VideoDockView = ReturnType<ReturnType<typeof createVideoGenerationDock>['view']>;
type VideoDockResources = Omit<ComponentProps<typeof BottomDialog>, 'initialText' | 'initialDoc' | 'initialParams' | 'attachments' | 'targetNodeId' | 'videoDraftBinding' | 'videoMediaRefs' | 'textIndexError' | 'onClose' | 'onSend'>;
interface VideoDockActions { close(): void; updateDraft(patch: VideoDockPatch): void; submit(input: VideoDockSend): Promise<void> }

export default function VideoGenerationDockPanel({ view, actions, resources }: { view: VideoDockView; actions: VideoDockActions; resources: VideoDockResources }) {
  return <BottomDialog
    {...resources}
    key={view.seed?.ts ?? 0}
    initialText={view.seed?.text}
    initialDoc={view.seed?.doc ?? null}
    initialParams={view.seed?.params}
    attachments={view.attachments}
    targetNodeId={view.seed?.targetNodeId}
    videoDraftBinding={{ ...view.draftBinding, onParamsChange: patch => { if (view.boundId) actions.updateDraft({ ...patch, targetNodeId: view.boundId }); } }}
    videoMediaRefs={view.mediaRefs}
    textIndexError={view.textIndexError ?? undefined}
    onClose={actions.close}
    onSend={(text, options, promptDoc) => actions.submit({ text, options, promptDoc })}
  />;
}
