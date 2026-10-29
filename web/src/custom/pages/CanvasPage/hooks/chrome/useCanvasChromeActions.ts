import { type AssetCardKind } from '@/custom/enums';
import type { Dispatch, SetStateAction } from 'react';
import type { MaterialAsset } from '@/custom/api/material';

import type { UploadedFile } from '../../components/ImageDialog';
import type { CanvasGalleryRef } from '../../media/collectMediaBlocks';

export function useCanvasChromeActions(input: {
  handleCreateAssetCard: (kind: AssetCardKind) => void;
  handleCreateProduct: () => void;
  characterLibraryTarget: 'image' | 'asset' | null;
  pickAssetId: string | null;
  setImagePickResult: Dispatch<SetStateAction<{ ts: number; files: UploadedFile[] } | null>>;
  setAssetPickResult: Dispatch<SetStateAction<{ ts: number; assetId: string; ref: CanvasGalleryRef } | null>>;
}) {
  const handleToolMenuSelect = (menu: string, item: string) => {
    if (menu === 'assets') {
      input.handleCreateAssetCard(item as AssetCardKind);
      return;
    }
    if (menu === 'goods' && item === 'create') {
      input.handleCreateProduct();
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
