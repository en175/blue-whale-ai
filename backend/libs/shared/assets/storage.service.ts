import { Injectable } from "@nestjs/common";
import type { AssetReader, AssetSigner } from "./ports.js";
import { createTosStorage, loadTosStorageConfig } from "./tos-storage.js";
import type { AssetUploadStorage } from "./upload.js";

type Storage = {
  signer: AssetSigner;
  reader: AssetReader;
  uploads: AssetUploadStorage;
};

@Injectable()
export class AssetStorageService {
  private storageInstance?: Storage | null;

  private get storage(): Storage | null {
    if (this.storageInstance === undefined) {
      const config = loadTosStorageConfig();
      this.storageInstance = config ? createTosStorage(config) : null;
    }
    return this.storageInstance;
  }

  get signer(): AssetSigner | null {
    return this.storage?.signer ?? null;
  }

  get reader(): AssetReader | null {
    return this.storage?.reader ?? null;
  }

  get uploads(): AssetUploadStorage | null {
    return this.storage?.uploads ?? null;
  }
}
