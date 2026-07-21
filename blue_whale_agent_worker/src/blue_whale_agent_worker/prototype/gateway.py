"""内存版 Fake Gateway：模拟 Java Product API 的分块持久化与发布门（原型）。

验证问题：IK2D8M 冻结的 start → chunk → complete → commit 协议在
真流式 Worker 下是否仍可满足——幂等键去重、同键异文冲突检测、
连续前缀审核（complete 前无可见文本）、全文 digest 封口。
不产生任何网络或付费行为。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .bundle import BundleError, STREAM_IDEMPOTENCY_CONFLICT, sha256_text

MAX_IDEMPOTENCY_KEY_LEN = 64


@dataclass
class _StreamState:
    chunks: dict[str, tuple[int, str]] = field(default_factory=dict)
    completed: tuple[str, int] | None = None
    aborted: bool = False


class FakeGateway:
    def __init__(self) -> None:
        self._streams: dict[str, _StreamState] = {}
        self._commits: dict[str, dict[str, object]] = {}
        self.duplicate_commits = 0

    # ---- Assistant 消息分块协议（对齐 IK2D8M） ----

    def start_assistant_message(self, run_id: int, payload: dict[str, object]) -> None:
        stream_id = str(payload["stream_id"])
        self._streams.setdefault(stream_id, _StreamState())

    def append_assistant_message_chunk(
        self, run_id: int, payload: dict[str, object]
    ) -> None:
        stream_id = str(payload["stream_id"])
        key = str(payload["idempotency_key"])
        if len(key) > MAX_IDEMPOTENCY_KEY_LEN:
            raise BundleError(
                STREAM_IDEMPOTENCY_CONFLICT, f"幂等键超过 {MAX_IDEMPOTENCY_KEY_LEN} 字符"
            )
        stream = self._streams[stream_id]
        chunks = stream.chunks
        incoming = (int(payload["seq"]), str(payload["text"]))
        if key in chunks:
            if chunks[key] != incoming:
                raise BundleError(
                    STREAM_IDEMPOTENCY_CONFLICT,
                    "同一幂等键携带不同内容，拒绝静默覆盖",
                )
            return  # 同键同文：确定性重放，幂等去重
        chunks[key] = incoming

    def complete_assistant_message(
        self, run_id: int, payload: dict[str, object]
    ) -> None:
        stream_id = str(payload["stream_id"])
        stream = self._streams[stream_id]
        digest = str(payload["digest"])
        count = int(payload["chunk_count"])
        chunks = stream.chunks
        ordered = [text for _, text in sorted(chunks.values(), key=lambda c: c[0])]
        seqs = sorted(seq for seq, _ in chunks.values())
        if seqs != list(range(1, count + 1)):
            raise BundleError(
                STREAM_IDEMPOTENCY_CONFLICT, "分块序号不连续，全文无法确定"
            )
        if sha256_text("".join(ordered)) != digest:
            raise BundleError(
                STREAM_IDEMPOTENCY_CONFLICT, "全文 digest 与已收分块不符"
            )
        stream.completed = (digest, count)

    def abort_assistant_message(self, run_id: int, payload: dict[str, object]) -> None:
        stream_id = str(payload["stream_id"])
        self._streams[stream_id].aborted = True

    # ---- RunCommit ----

    def commit(self, run_id: int, payload: dict[str, object]) -> bool:
        commit_id = str(payload["commit_id"])
        if commit_id in self._commits:
            self.duplicate_commits += 1
            return False  # 重复提交：幂等去重，不产生二次效果
        self._commits[commit_id] = payload
        return True

    # ---- 测试观测面 ----

    def acked_seq(self, stream_id: str) -> int:
        stream = self._streams.get(stream_id)
        if not stream:
            return 0
        seqs = sorted(seq for seq, _ in stream.chunks.values())
        acked = 0
        for seq in seqs:
            if seq == acked + 1:
                acked = seq
            else:
                break
        return acked

    def released_text(self, stream_id: str) -> str:
        """发布门视角：只有 completed 且未 abort 的流才有可见文本。"""
        stream = self._streams.get(stream_id)
        if not stream or stream.completed is None or stream.aborted:
            return ""
        return "".join(
            text for _, text in sorted(stream.chunks.values(), key=lambda c: c[0])
        )

    def is_aborted(self, stream_id: str) -> bool:
        stream = self._streams.get(stream_id)
        return bool(stream and stream.aborted)

    def commit_payload(self, commit_id: str) -> dict[str, object] | None:
        return self._commits.get(commit_id)
