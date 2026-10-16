import type { RecoveryChange } from '@/custom/api/canvasRecovery';
import type { LedgerEntry } from './types';
import { TARGET_OUTPUT_KEY, type RuntimeContext } from './runtimeState';

export function createSave(ctx: RuntimeContext) {
  const { host, ledger, reconciledSubmissions, unavailableOutputItems, intents, newId, readMarker, setLedger } = ctx;

  const composeSaveFields = (): { commandId: string; recoveryChanges: RecoveryChange[] } | null => {
    const changes: RecoveryChange[] = [];
    const nodes = host.getMediaNodes();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const entry of ledger.values()) {
      if (!reconciledSubmissions.has(entry.submissionId)) continue;
      if (entry.state === 'replaced' || entry.state === 'transferred') continue;
      const node = nodeById.get(entry.nodeId);
      const marker = readMarker(node?.data);
      const matches = node != null && marker != null
        && marker.submissionId === entry.submissionId && marker.outputKey === entry.outputKey;
      const intent = intents.get(entry.submissionId);
      if (entry.outputKey === TARGET_OUTPUT_KEY && intent?.kind === 'settle' && node != null) {
        if (entry.state === 'pending' || entry.state === 'present') {
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'settleTarget' });
        }
        continue;
      }
      if (matches) {
        if (entry.state === 'pending') {
          if (unavailableOutputItems.has(entry.recoveryItemId)) continue;
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'apply' });
        } else if (entry.state === 'removed') {
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'restore' });
        }
      } else if (entry.state === 'pending' || entry.state === 'present') {
        if (entry.outputKey === TARGET_OUTPUT_KEY && intent?.kind === 'convert') {
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'replaceTarget' });
        } else if (node == null) {
          if (unavailableOutputItems.has(entry.recoveryItemId) && !host.isLocallyRemoved(entry.nodeId)) continue;
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'remove' });
        }
      }
    }
    if (changes.length === 0) return null;
    return { commandId: newId(), recoveryChanges: changes };
  };

  const onSaveReceipt = (receipt: { commandId: string; replayed: boolean; changes: Array<{ recoveryItemId: string; revision: number; nodeBindingRevision: number; state: string }> }) => {
    for (const change of receipt.changes) {
      const entry = ledger.get(change.recoveryItemId);
      if (!entry) continue;
      setLedger({
        ...entry,
        state: change.state as LedgerEntry['state'],
        revision: change.revision,
        ...(change.nodeBindingRevision > 0 ? { nodeBindingRevision: change.nodeBindingRevision } : {}),
      });
      if (entry.outputKey === TARGET_OUTPUT_KEY && (change.state === 'present' || change.state === 'replaced')) {
        intents.delete(entry.submissionId);
      }
      if (change.state === 'removed') intents.delete(entry.submissionId);
    }
  };

  return { composeSaveFields, onSaveReceipt };
}
