import { useCallback, useState } from 'react';
import type { AudioRefItem } from '../components/AudioDialog';
import type { UploadedFile } from '../components/ImageDialog';
import type { CanvasGalleryRef } from '../collectMediaBlocks';
import type { SessionContentBlock } from '@/custom/api/agentSessions';

import { type PickChannel, type VideoRefRole } from '@/custom/enums';

export function useCanvasPickers() {
  const [pickMode, setPickMode] = useState<PickChannel | null>(null);
  const [pickTarget, setPickTarget] = useState<PickChannel | null>(null);
  const [pickRefRole, setPickRefRole] = useState<VideoRefRole | null>(null);
  const [imagePickSession, setImagePickSession] = useState<string | null | undefined>(undefined);
  const endImagePickSession = useCallback(() => {
    setImagePickSession(undefined);
    setPickMode(null);
    setPickTarget(null);
  }, []);
  const imagePickSessionActive = pickMode === 'image' && pickTarget === 'image' && imagePickSession !== undefined;
  const [videoPickSession, setVideoPickSession] = useState<string | null | undefined>(undefined);
  const endVideoPickSession = useCallback(() => {
    setVideoPickSession(undefined);
    setPickMode(null);
    setPickTarget(null);
    setPickRefRole(null);
  }, []);
  const videoPickSessionActive = pickTarget === 'video'
    && (pickMode === 'image' || pickMode === 'video')
    && videoPickSession !== undefined;
  const [audioPickSession, setAudioPickSession] = useState<string | null | undefined>(undefined);
  const endAudioPickSession = useCallback(() => {
    setAudioPickSession(undefined);
    setPickMode(null);
    setPickTarget(null);
  }, []);
  const audioPickSessionActive = pickMode === 'audio' && pickTarget === 'audio' && audioPickSession !== undefined;
  const [pickProductId, setPickProductId] = useState<string | null>(null);
  const [pickAssetId, setPickAssetId] = useState<string | null>(null);
  const [imagePickResult, setImagePickResult] = useState<{ ts: number; files: UploadedFile[] } | null>(null);
  const [productPickResult, setProductPickResult] = useState<{ ts: number; productId: string; image: { id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string } } | null>(null);
  const [assetPickResult, setAssetPickResult] = useState<{ ts: number; assetId: string; ref: CanvasGalleryRef } | null>(null);
  const [audioPickResult, setAudioPickResult] = useState<{ ts: number; item: AudioRefItem } | null>(null);
  const [audioAssetPickResult, setAudioAssetPickResult] = useState<{ ts: number; items: AudioRefItem[] } | null>(null);
  const [audioAssetPickTarget, setAudioAssetPickTarget] = useState<{ nodeId: string | null; seed: number | undefined } | null>(null);
  const [musicPickResult, setMusicPickResult] = useState<{ ts: number; item: AudioRefItem } | null>(null);
  const [showAssetsPicker, setShowAssetsPicker] = useState(false);
  const [assetsPickerTarget, setAssetsPickerTarget] = useState<'toolbar' | 'videoDraft' | 'imageDialog' | 'audioDialog' | 'agentPanel'>('toolbar');
  const openAssetsPicker = (target: typeof assetsPickerTarget) => {
    setAssetsPickerTarget(target);
    setShowAssetsPicker(true);
  };
  const [videoAssetPickRole, setVideoAssetPickRole] = useState<VideoRefRole>('reference');
  const [videoAssetPickKind, setVideoAssetPickKind] = useState<'image' | 'video'>('video');
  const [agentAssetPicks, setAgentAssetPicks] = useState<{ ts: number; blocks: SessionContentBlock[] } | null>(null);

  return {
    pickMode, setPickMode,
    pickTarget, setPickTarget,
    pickRefRole, setPickRefRole,
    imagePickSession, setImagePickSession,
    endImagePickSession,
    imagePickSessionActive,
    videoPickSession, setVideoPickSession,
    endVideoPickSession,
    videoPickSessionActive,
    audioPickSession, setAudioPickSession,
    endAudioPickSession,
    audioPickSessionActive,
    pickProductId, setPickProductId,
    pickAssetId, setPickAssetId,
    imagePickResult, setImagePickResult,
    productPickResult, setProductPickResult,
    assetPickResult, setAssetPickResult,
    audioPickResult, setAudioPickResult,
    audioAssetPickResult, setAudioAssetPickResult,
    audioAssetPickTarget, setAudioAssetPickTarget,
    musicPickResult, setMusicPickResult,
    showAssetsPicker, setShowAssetsPicker,
    assetsPickerTarget, setAssetsPickerTarget,
    openAssetsPicker,
    videoAssetPickRole, setVideoAssetPickRole,
    videoAssetPickKind, setVideoAssetPickKind,
    agentAssetPicks, setAgentAssetPicks,
  };
}
