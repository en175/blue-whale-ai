"""可见文本成块边界（IK3BG3）：ChunkFormer 是唯一文本分块边界。

64 字符满窗切块、finish() 出尾块并以全文 sha256 digest 封口、幂等键 ≤64 字符，
对齐 IK2D8M 冻结的 start/chunk/complete 三段式协议与原型蓝本
（prototype/runtime.py 的 ChunkFormer，IK2D8I 实测形态）。chunk payload 只含协议
字段与消毒后文本：provider 的 tool_call_id、原始事件、usage 明细一律不进分块，
文本事件与 deferred 工具 / Job / Asset 事件不混流（契约 §5 / ADR-0025）。
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable, Mapping

# 可见文本切块窗口（字符数）：定长切分保证同一文本重放时逐块确定，
# 支撑传输重试的同键同文幂等去重（契约 §5，原型 IK2D8M 对齐值）。
CHUNK_WINDOW = 64

MAX_IDEMPOTENCY_KEY_LEN = 64


def operation_idempotency_key(run_id: int, operation: str) -> str:
    """start / chunk / complete / abort 幂等键：run_id + 操作派生，确定性且 ≤64 字符。

    同一尝试的传输重试复用同一 stream_id 与同键（Java 在流内按同键同文幂等去重、
    同键异文拒绝）；新尝试换新 stream_id，Java 幂等作用域按流隔离，键不跨流冲突。
    """
    identity = f"{run_id}:{operation}".encode("utf-8")
    return f"assistant-{hashlib.sha256(identity).hexdigest()[:54]}"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def review_evidence_for(work: Any) -> dict[str, Any]:
    """chunk 的审核证据来源标记：fake 引擎本地闭环 / 真流式前缀（ADR-0025）。"""
    return {"source": "local-fake" if work.engine == "fake" else "worker-prefix"}


def emit_text_chunks(
    text: str,
    *,
    work: Any,
    stream_id: str,
    emit_chunk: Callable[[Mapping[str, Any]], None],
) -> None:
    """把整段可见文本经 ChunkFormer 一次性成块并逐块回调。

    非增量产出文本的调用方（FakeOrchestrator、测试桩等）与真流式路径共用唯一
    成块边界：64 字符满窗切块 + finish() 尾块，幂等键与 evidence 形态一致。
    """
    former = ChunkFormer(
        run_id=work.agent_run_id,
        stream_id=stream_id,
        review_evidence=review_evidence_for(work),
    )
    for chunk in former.feed(text):
        emit_chunk(chunk)
    tail, _digest, _count = former.finish()
    for chunk in tail:
        emit_chunk(chunk)


class ChunkFormer:
    """把可见文本增量切成 64 字符满窗分块；finish() 出尾块并给全文 digest 封口。

    产出的 chunk payload 是 IK2D8M append 协议的流字段子集（stream_id /
    idempotency_key / sequence_no / content / review_evidence）；RunBinding 七字段
    由 Worker 在发送前合并（start/advance(sink)/complete/abort 的编排顺序归 Worker）。
    """

    def __init__(
        self,
        run_id: int,
        stream_id: str,
        review_evidence: Mapping[str, Any],
    ) -> None:
        self._run_id = run_id
        self._stream_id = stream_id
        self._review_evidence = dict(review_evidence)
        self._seq = 1
        self._buffer = ""
        self._full_text = ""

    def feed(self, delta: str) -> list[dict[str, Any]]:
        """喂入文本增量，返回所有新满窗（64 字符）分块；不足一窗的尾部留存缓冲。"""
        self._full_text += delta
        self._buffer += delta
        chunks: list[dict[str, Any]] = []
        while len(self._buffer) >= CHUNK_WINDOW:
            chunks.append(self._emit(self._buffer[:CHUNK_WINDOW]))
            self._buffer = self._buffer[CHUNK_WINDOW:]
        return chunks

    def finish(self) -> tuple[list[dict[str, Any]], str, int]:
        """收尾：尾块（不足一窗的留存，可空）+ 全文 sha256 digest + 末块 sequence_no。"""
        chunks = [self._emit(self._buffer)] if self._buffer else []
        self._buffer = ""
        return chunks, sha256_text(self._full_text), self._seq - 1

    @property
    def full_text(self) -> str:
        """本尝试已喂入的全部可见文本（complete 的 content_digest 与 commit 的
        visible_text 必须与之逐字节一致，Java 以流内容比对封口）。"""
        return self._full_text

    def _emit(self, text: str) -> dict[str, Any]:
        chunk = {
            "stream_id": self._stream_id,
            "idempotency_key": operation_idempotency_key(
                self._run_id, f"chunk:{self._seq}"
            ),
            "sequence_no": self._seq,
            "content": text,
            "review_evidence": dict(self._review_evidence),
        }
        self._seq += 1
        return chunk
