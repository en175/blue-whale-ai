import { describe, it, expect } from "vitest";
import { readSseStream } from "./sse";
import type { SseReader } from "./sse";

const enc = (s: string) => new TextEncoder().encode(s);

/** 用一组 chunk 构造 mock reader：依次 read 返回各 chunk，最后 done。 */
function makeReader(chunks: Uint8Array[]): SseReader {
  let i = 0;
  return {
    read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
  } as SseReader;
}

async function drain(chunks: Uint8Array[]): Promise<string[]> {
  const events: string[] = [];
  await readSseStream(makeReader(chunks), (d) => events.push(d));
  return events;
}

describe("readSseStream", () => {
  it("单帧派发 data", async () => {
    expect(await drain([enc('data: {"a":1}\n\n')])).toEqual(['{"a":1}']);
  });

  it("多帧逐个派发", async () => {
    expect(await drain([enc("data: a\n\ndata: b\n\n")])).toEqual(["a", "b"]);
  });

  it("跨 chunk 断帧累积", async () => {
    expect(await drain([enc("data: hel"), enc("lo\n\n")])).toEqual(["hello"]);
  });

  it("多 data 行用换行拼接", async () => {
    expect(await drain([enc("data: line1\ndata: line2\n\n")])).toEqual(["line1\nline2"]);
  });

  it("冒号后仅去一个前导空格", async () => {
    // "data:  two"（两个空格）→ 去一个 → " two"
    expect(await drain([enc("data:  two\n\n")])).toEqual([" two"]);
  });

  it("注释心跳行忽略", async () => {
    expect(await drain([enc(": ping\n\ndata: a\n\n")])).toEqual(["a"]);
  });

  it("CRLF 分隔", async () => {
    expect(await drain([enc("data: a\r\n\r\n")])).toEqual(["a"]);
  });

  it("CRLF 多 data 行", async () => {
    expect(await drain([enc("data: l1\r\ndata: l2\r\n\r\n")])).toEqual(["l1\nl2"]);
  });

  it("无 data 行不派发", async () => {
    expect(await drain([enc("event: ping\nid: 1\n\n")])).toEqual([]);
  });

  it("尾部残帧不派发", async () => {
    expect(await drain([enc("data: incomplete")])).toEqual([]);
  });

  it("末帧完整则派发、残帧丢弃", async () => {
    expect(await drain([enc("data: a\n\ndata: b")])).toEqual(["a"]);
  });
});
