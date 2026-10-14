import type { Dispatch, SetStateAction } from 'react';
import type { MaterialAsset } from '@/api/material';
import type { AssetCardKind } from '../components/AssetCardNode';
import type { UploadedFile } from '../components/ImageDialog';
import type { CanvasGalleryRef } from '../collectMediaBlocks';
import type { CardFilter } from '../components/SharedAssetsModal';

export function useCanvasChromeActions(input: {
  setAssetsModalDefaultTab: Dispatch<SetStateAction<string | undefined>>;
  setAssetsModalDefaultFilter: Dispatch<SetStateAction<CardFilter | undefined>>;
  setShowAssetsModal: Dispatch<SetStateAction<boolean>>;
  handleCreateAssetCard: (kind: AssetCardKind) => void;
  handleCreateProduct: () => void;
  characterLibraryTarget: 'image' | 'asset' | null;
  pickAssetId: string | null;
  setImagePickResult: Dispatch<SetStateAction<{ ts: number; files: UploadedFile[] } | null>>;
  setAssetPickResult: Dispatch<SetStateAction<{ ts: number; assetId: string; ref: CanvasGalleryRef } | null>>;
}) {
  const handleToolMenuSelect = (menu: string, item: string) => {
    if (menu === 'assets' && item === 'shared') {
      input.setAssetsModalDefaultTab(undefined);
      input.setAssetsModalDefaultFilter('all-assets');
      input.setShowAssetsModal(true);
      return;
    }
    if (menu === 'assets') {
      input.handleCreateAssetCard(item as AssetCardKind);
      return;
    }
    if (menu === 'goods' && item === 'create') {
      input.handleCreateProduct();
      return;
    }
    if (menu === 'goods' && item === 'import') {
      input.setAssetsModalDefaultTab('goods');
      input.setAssetsModalDefaultFilter(undefined);
      input.setShowAssetsModal(true);
    }
  };
  const handleCharacterLibrarySelect = (assets: MaterialAsset[]) => {
    const ts = Date.now();
    if (input.characterLibraryTarget === 'image') {
      const images = assets
        .filter((a) => a.AssetType === 'Image')
        .map((a) => ({
          id: `char-${ts}-${a.Id}`,
          url: a.URL,
          type: 'image' as const,
          name: `角色-${a.Name}`,
          assetId: a.Id,
        }));
      if (images.length > 0) input.setImagePickResult({ ts, files: images });
    } else if (input.characterLibraryTarget === 'asset') {
      const image = assets.find((a) => a.AssetType === 'Image');
      if (image) {
        input.setAssetPickResult({
          ts,
          assetId: input.pickAssetId ?? '',
          ref: {
            id: `char-${ts}`,
            src: image.URL,
            type: 'image',
            assetId: image.Id,
          },
        });
      }
    }
  };
  return { handleToolMenuSelect, handleCharacterLibrarySelect };
}
