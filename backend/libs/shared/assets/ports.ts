export interface SignOptions {
  forModelReading?: boolean;
}

export interface AssetSigner {
  sign(storageKey: string, options?: SignOptions): Promise<{ url: string; expiresAt: Date }>;
}

export interface AssetReader {
  read(storageKey: string): Promise<Uint8Array>;
}
