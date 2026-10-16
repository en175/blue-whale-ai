import type { GenerationRuntimeHost, RecoverySeedSource, RecoverySeedTarget, RuntimeNodeView } from './types';

export function seedTargetOfNode(node: RuntimeNodeView): RecoverySeedTarget {
  const data = node.data ?? {};
  const role = data.draft === true
    ? 'draft'
    : typeof data.assetId === 'string' && data.assetId.length > 0
      ? 'existing-media'
      : 'result-placeholder';
  return {
    role,
    x: node.position.x,
    y: node.position.y,
    width: typeof data.width === 'number' && data.width > 0 ? data.width : 320,
    height: typeof data.height === 'number' && data.height > 0 ? data.height : 320,
    name: typeof data.fileName === 'string' ? data.fileName : '',
  };
}

export function seedSourcesOfNode(nodeId: string, host: GenerationRuntimeHost): RecoverySeedSource[] {
  return host.getEdges()
    .filter((edge) => edge.target === nodeId)
    .map((edge) => host.findNode(edge.source))
    .filter((source): source is RuntimeNodeView => source != null && source.type === 'mediaNode')
    .map((source) => ({
      node_id: source.id,
      x: source.position.x,
      y: source.position.y,
      width: typeof source.data?.width === 'number' && source.data.width > 0 ? source.data.width : 320,
      height: typeof source.data?.height === 'number' && source.data.height > 0 ? source.data.height : 320,
      name: typeof source.data?.fileName === 'string' ? source.data.fileName : '',
    }));
}
