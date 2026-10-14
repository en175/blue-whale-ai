import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { SessionContentBlock } from '@/api/agentSessions';
import { takeAgentHandoff } from '@/utils/agent-handoff';
import { rememberAssetUrl } from '../components/AgentPanel/assetUrlCache';

export function useCanvasHomeAgentInject(input: {
  doc: unknown | null;
  placeFileOnCanvas: (file: File) => Promise<{ asset_id: string; url: string; nodeId: string }>;
  setAgentAssetPicks: Dispatch<SetStateAction<{ ts: number; blocks: SessionContentBlock[] } | null>>;
}): void {
  const { doc, placeFileOnCanvas, setAgentAssetPicks } = input;
  const homeHandoffDoneRef = useRef(false);
  const placeFileOnCanvasRef = useRef(placeFileOnCanvas);
  placeFileOnCanvasRef.current = placeFileOnCanvas;
  useEffect(() => {
    if (!doc) return;
    if (homeHandoffDoneRef.current) return;
    const attachments = takeAgentHandoff();
    if (!attachments || attachments.length === 0) return;
    homeHandoffDoneRef.current = true;
    let cancelled = false;
    const inject = async () => {
      const blocks: SessionContentBlock[] = [];
      for (const item of attachments) {
        if (item.assetId != null) {
          rememberAssetUrl(String(item.assetId), item.preview);
          blocks.push({
            type: 'asset_ref',
            url: item.preview,
            name: item.name,
            media_type: item.kind,
            display_label: item.name,
            asset_id: String(item.assetId),
          });
        } else if (item.file) {
          try {
            const result = await placeFileOnCanvasRef.current(item.file);
            if (cancelled) return;
            rememberAssetUrl(result.asset_id, result.url);
            blocks.push({
              type: 'asset_ref',
              url: result.url,
              name: item.name,
              media_type: item.kind,
              display_label: item.name,
              asset_id: result.asset_id,
            });
          } catch {
          }
          URL.revokeObjectURL(item.preview);
        } else {
          console.warn('首页附件缺少 file/assetId，已跳过:', item.name);
        }
      }
      if (!cancelled && blocks.length > 0) {
        setAgentAssetPicks({ ts: Date.now(), blocks });
      }
    };
    void inject();
    return () => { cancelled = true; };
  }, [doc, setAgentAssetPicks]);
}
