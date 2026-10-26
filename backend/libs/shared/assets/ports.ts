export interface SignOptions {
  forModelReading?: boolean;
}

export interface AssetSigner {
  sign(storageKey: string, options?: SignOptions): Promise<{ url: string; expiresAt: Date }>;
}

export interface AssetReader {
  read(storageKey: string): Promise<Uint8Array>;
}

export interface MediaInfo {
  sizeBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  container: string | null;
  fps: number | null;
}

export type AssetProbe = (storageKey: string) => Promise<MediaInfo>;
