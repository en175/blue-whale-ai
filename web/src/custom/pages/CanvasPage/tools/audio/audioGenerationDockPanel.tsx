import type { ComponentProps } from 'react';
import AudioDialog from '../../components/AudioDialog/index';
import type { createAudioMusicGenerationDocks, AudioDockPatch, AudioDockSend } from './audioMusicGenerationDock';

type AudioDockView = ReturnType<ReturnType<typeof createAudioMusicGenerationDocks>['audio']['view']>;
type AudioDockResources = Omit<ComponentProps<typeof AudioDialog>, 'initialText' | 'initialDoc' | 'initialRefs' | 'initialModelId' | 'draftBinding' | 'draftRefs' | 'draftRefInvalid' | 'textIndexError' | 'attachments' | 'onClose' | 'onSend' | 'onSwitchToMusic'>;
interface AudioDockActions { close(): void; updateDraft(patch: AudioDockPatch): void; submit(input: AudioDockSend): Promise<void>; switchToMusic(): void }

export default function AudioGenerationDockPanel({ view, actions, resources }: { view: AudioDockView; actions: AudioDockActions; resources: AudioDockResources }) {
  return <AudioDialog
    {...resources}
    key={view.seed?.ts ?? 0}
    initialText={view.seed?.text}
    initialDoc={view.seed?.doc}
    initialRefs={view.seed?.refs}
    initialModelId={view.seed?.modelId}
    draftBinding={view.draftBinding ? { ...view.draftBinding, onParamsChange: patch => actions.updateDraft({ ...patch, targetNodeId: view.boundId ?? undefined }) } : undefined}
    draftRefs={view.draftRefs}
    draftRefInvalid={view.draftRefInvalid}
    textIndexError={view.textIndexError}
    attachments={view.attachments}
    onClose={actions.close}
    onSend={(text, modelId, refs, promptDoc) => actions.submit({ text, modelId, refs, promptDoc })}
    onSwitchToMusic={actions.switchToMusic}
  />;
}
