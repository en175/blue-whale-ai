import { useMutation } from '@tanstack/react-query';
import { linkAssetToProject } from '@/custom/api/assets';
import { applyPromptPreview } from '@/custom/api/canvas';

export function useCanvasPageMutations() {
  const applyMutation = useMutation({ mutationFn: applyPromptPreview });
  const linkAudioMixAssetsMutation = useMutation({
    mutationFn: (vars: { projectId: string; assetIds: string[] }) =>
      Promise.all(vars.assetIds.map((assetId) => linkAssetToProject(vars.projectId, assetId, { silent: true }))),
  });
  return {
    applyMutation,
    linkAudioMixAssets: (vars: { projectId: string; assetIds: string[] }) =>
      linkAudioMixAssetsMutation.mutateAsync(vars),
  };
}
