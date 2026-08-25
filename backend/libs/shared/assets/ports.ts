export interface SignOptions {
  /**
   * 把这张图签成「给模型读的」降采样版本，而不是原图（IKAZC2）。
   *
   * 语义化而不是让调用方直接传对象存储的处理参数：降采样是**读取意图**，具体怎么实现
   * （TOS 的 x-tos-process、别家的等价物、或者退化成不处理）是存储适配器的事。调用方
   * 那一层不该知道 bucket 是谁家的。
   *
   * 适配器不支持时忽略即可，返回原图 URL——降采样是优化，不是正确性前提。
   */
  forModelReading?: boolean;
}

export interface AssetSigner {
  sign(storageKey: string, options?: SignOptions): Promise<{ url: string; expiresAt: Date }>;
}

export interface AssetReader {
  read(storageKey: string): Promise<Uint8Array>;
}
