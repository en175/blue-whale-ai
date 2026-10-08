let seq = 0;

export function newNodeId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}
