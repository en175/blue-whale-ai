/** 资产读路径的两个外部端口（对齐 Java GenerationObjectSigner / GenerationObjectReader）。
 *  Java 用 ObjectProvider 注入、缺失时 getIfAvailable() 返 null → 路径判 ASSET_UNAVAILABLE。
 *  Node 端 deps 传 null 等价「未配置 signer/reader」。 */

export interface AssetSigner {
  /** 为 storageKey 签发短期可访问 URL（对齐 TOSV2.preSignedURL GET）。 */
  sign(storageKey: string): Promise<{ url: string; expiresAt: Date }>;
}

export interface AssetReader {
  /** 读取对象原始字节（对齐 TosGenerationStorage#read，含大小上限保护）。 */
  read(storageKey: string): Promise<Uint8Array>;
}
