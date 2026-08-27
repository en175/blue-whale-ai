import { describe, expect, it, vi } from 'vitest';
import { removeCancelledGenerationNode } from './generationPolling';

describe('removeCancelledGenerationNode', () => {
  it('stops the scheduled poll and removes the cancelled node', () => {
    const timers = new Map([['generation-node', 42]]);
    const removeNode = vi.fn();
    const clearTimer = vi.fn();

    removeCancelledGenerationNode('generation-node', timers, removeNode, clearTimer);

    expect(clearTimer).toHaveBeenCalledWith(42);
    expect(timers.has('generation-node')).toBe(false);
    expect(removeNode).toHaveBeenCalledWith('generation-node');
  });

  it('still removes the node when no poll has been scheduled yet', () => {
    const removeNode = vi.fn();

    removeCancelledGenerationNode('generation-node', new Map(), removeNode, vi.fn());

    expect(removeNode).toHaveBeenCalledWith('generation-node');
  });
});
