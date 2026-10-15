
export interface AgentHandoffItem {
  file?: File;
  preview: string;
  name: string;
  kind: 'image' | 'video';
  assetId?: string | number;
}

let pending: AgentHandoffItem[] | null = null;

export function setAgentHandoff(items: AgentHandoffItem[]) {
  pending = items;
}

export function takeAgentHandoff(): AgentHandoffItem[] | null {
  const items = pending;
  pending = null;
  return items;
}
