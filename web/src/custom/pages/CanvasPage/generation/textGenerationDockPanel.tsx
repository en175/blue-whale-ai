import type { ComponentProps } from 'react';
import TextGenDialog from '../components/TextGenDialog';
import type { createTextGenerationDock, TextDockPatch, TextDockSend } from './textGenerationDock';

type TextDockView = ReturnType<ReturnType<typeof createTextGenerationDock>['view']>;
type TextDockResources = Pick<ComponentProps<typeof TextGenDialog>, 'followAnchor' | 'dragHidden'>;
interface TextDockActions { close(): void; updateDraft(patch: TextDockPatch): void; submit(input: TextDockSend): void }

export default function TextGenerationDockPanel({ view, actions, resources }: { view: TextDockView; actions: TextDockActions; resources: TextDockResources }) {
  return <TextGenDialog
    {...resources}
    key={view.boundId}
    initialText={view.initialText}
    attachments={view.attachments}
    onClose={actions.close}
    onSend={(text, modelId) => actions.submit({ text, modelId, targetNodeId: view.boundId ?? undefined })}
    onParamsChange={patch => actions.updateDraft({ ...patch, targetNodeId: view.boundId ?? undefined })}
  />;
}
