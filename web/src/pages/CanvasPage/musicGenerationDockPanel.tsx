import type { ComponentProps } from 'react';
import MusicDialog from './components/MusicDialog';
import type { MusicDockSend } from './audioMusicGenerationDock';

type MusicDockResources = Omit<ComponentProps<typeof MusicDialog>, 'onClose' | 'onSend' | 'onSwitchToAudio'>;
interface MusicDockActions { close(): void; submit(input: MusicDockSend): void; switchToAudio(): void }

export default function MusicGenerationDockPanel({ actions, resources }: { actions: MusicDockActions; resources: MusicDockResources }) {
  return <MusicDialog {...resources} onClose={actions.close} onSend={(text, model, options, refs) => actions.submit({ text, model, options, refs })} onSwitchToAudio={actions.switchToAudio} />;
}
