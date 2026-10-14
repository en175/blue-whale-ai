import { useRef } from 'react';
import { syncCanvasNodeActions } from './patchCanvasNodeActions';

export type CanvasPageNodeActions = {
  duplicate: (id: string) => void;
  addToChat: (id: string) => void;
  pasteAtNode: (id: string) => void;
  copyImage: (id: string) => void;
  complianceCheck: (id: string) => void;
  fillEmptyShell: (id: string, file: File) => void;
  openImageDialog: () => void;
  cancelJob: (id: string) => void;
  retryJob: (id: string) => void;
  fixFollowVideo: (id: string) => void;
  removeMediaNode: (id: string) => void;
  download: (id: string) => void;
  showDetails: (id: string) => void;
  firePendingGen: () => void;
  firePendingVideoDraft: () => void;
  renameCard: (id: string, name: string) => void;
};

const idleAction = (_id?: string, _extra?: unknown) => {};

export function useCanvasNodeActions() {
  const actionsRef = useRef<CanvasPageNodeActions>({
    duplicate: idleAction,
    addToChat: idleAction,
    pasteAtNode: idleAction,
    copyImage: idleAction,
    complianceCheck: idleAction,
    fillEmptyShell: idleAction as CanvasPageNodeActions['fillEmptyShell'],
    openImageDialog: idleAction,
    cancelJob: idleAction,
    retryJob: idleAction,
    fixFollowVideo: idleAction,
    removeMediaNode: idleAction,
    download: idleAction,
    showDetails: idleAction,
    firePendingGen: idleAction,
    firePendingVideoDraft: idleAction,
    renameCard: idleAction as CanvasPageNodeActions['renameCard'],
  });
  const bindActions = (patch: Partial<CanvasPageNodeActions>) => {
    syncCanvasNodeActions(actionsRef.current, patch);
  };
  return { actionsRef, bindActions };
}
