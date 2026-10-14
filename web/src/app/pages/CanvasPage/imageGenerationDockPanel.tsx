import type { ComponentProps } from 'react';
import ImageDialog from './components/ImageDialog';
import type { createImageGenerationDock, ImageDockPatch, ImageDockSend } from './imageGenerationDock';

type ImageDockView = ReturnType<ReturnType<typeof createImageGenerationDock>['view']>;
type ImageDockResources = Omit<ComponentProps<typeof ImageDialog>,
  'initialText' | 'initialDoc' | 'initialFiles' | 'initialParams' | 'attachments' | 'mediaRefs'
  | 'invalidMediaRefs' | 'textIndexError' | 'draftBinding' | 'onClose' | 'onSend'>;
interface ImageDockActions {
  close(): void;
  updateDraft(patch: ImageDockPatch): void;
  submit(input: ImageDockSend): Promise<void>;
}

export default function ImageGenerationDockPanel({ view, actions, resources }: {
  view: ImageDockView;
  actions: ImageDockActions;
  resources: ImageDockResources;
}) {
  return <ImageDialog
    {...resources}
    key={view.seed?.ts ?? 0}
    initialText={view.seed?.text}
    initialDoc={view.seed?.promptDoc ?? null}
    initialFiles={view.seedView?.files}
    initialParams={view.seed?.params}
    attachments={view.attachments}
    mediaRefs={view.mediaRefs}
    invalidMediaRefs={view.invalidMediaRefs}
    textIndexError={view.textIndexError ?? undefined}
    draftBinding={view.draftBinding ? { ...view.draftBinding, onParamsChange: patch => actions.updateDraft({ ...patch, targetNodeId: view.boundId! }) } : undefined}
    onClose={actions.close}
    onSend={(text, modelId, size, ratio, files, promptDoc) => actions.submit({ text, modelId, size, ratio, files, promptDoc })}
  />;
}
