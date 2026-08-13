export interface AssetSigner {
  sign(storageKey: string): Promise<{ url: string; expiresAt: Date }>;
}

export interface AssetReader {
  read(storageKey: string): Promise<Uint8Array>;
}
