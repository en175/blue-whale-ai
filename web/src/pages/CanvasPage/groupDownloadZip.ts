/* 组下载打包：无压缩 ZIP（STORE），避免多文件 a.click 被浏览器拦截 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff);
}

function u32(n: number): Uint8Array {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

export function uniqueDownloadName(name: string, used: Set<string>): string {
  const safe = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'download';
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let i = 2;
  let next = `${base} (${i})${ext}`;
  while (used.has(next)) {
    i += 1;
    next = `${base} (${i})${ext}`;
  }
  used.add(next);
  return next;
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

function bytesStartWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((b, i) => bytes[i] === b);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** 从文件头识别真实媒体 MIME，避免 zip 内条目扩展名与内容不符导致「格式错误」 */
export async function sniffMediaMime(blob: Blob): Promise<string | undefined> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (bytesStartWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytesStartWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (bytesStartWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (asciiAt(head, 0, 'RIFF') && asciiAt(head, 8, 'WEBP')) return 'image/webp';
  if (asciiAt(head, 0, 'RIFF') && asciiAt(head, 8, 'WAVE')) return 'audio/wav';
  if (asciiAt(head, 4, 'ftyp')) return 'video/mp4';
  if (bytesStartWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (asciiAt(head, 0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return undefined;
}

/** 把若干文件打成无压缩 zip，一次下载即可带出全部素材 */
export async function buildStoreZip(files: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const size = data.length;
    const local = concatBytes([
      Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    const central = concatBytes([
      Uint8Array.of(0x50, 0x4b, 0x01, 0x02),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = concatBytes(centrals);
  const eocd = concatBytes([
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  const zipBytes = concatBytes([...locals, centralDir, eocd]);
  const zipBuffer = new ArrayBuffer(zipBytes.byteLength);
  new Uint8Array(zipBuffer).set(zipBytes);
  return new Blob([zipBuffer], { type: 'application/zip' });
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
