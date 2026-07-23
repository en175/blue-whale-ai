"""IK3BG3 RecordingGateway 观测面测试：原型 RecordingGateway/FakeGateway 的
观测形态落到生产 Worker 路径——在线接收与断线重放一致、无重复无缺块、
同键同文幂等去重、同键异文拒绝、abort 后整流重建。"""

import unittest

from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator
from blue_whale_agent_worker.streaming import sha256_text
from blue_whale_agent_worker.worker import AgentWorker
from test_pydantic_orchestrator import (
    _bundle_source,
    _pydantic_work,
    image_proposal_model,
    streaming_model,
)
from test_worker import _fake_work, _static_result, _StaticOrchestrator


class StreamState:
    def __init__(self) -> None:
        self.chunks = {}  # sequence_no -> (idempotency_key, content)
        self.completed = None  # (digest, final_sequence_no)
        self.abort_reason = None


class ObservingRunGateway:
    """模拟 Java Product API 分块持久化与发布门的观测面（原型 FakeGateway 蓝本）。

    幂等语义对齐契约 §3.4 与 Java 实现：chunk 按流内 sequence_no 判重——同键同文
    幂等去重（传输重试 / 确定性重放），同键异文或异键同序拒绝；complete 校验序号
    连续（无缺块）且全文 digest 封口；aborted 尝试不释放任何文本。
    """

    def __init__(self, work) -> None:
        self.work = work
        self.streams: dict[str, StreamState] = {}
        self.commit_payload = None

    def claim(self):
        return self.work

    def commit(self, run_id: int, payload: dict) -> None:
        self.commit_payload = payload

    def start_assistant_message(self, run_id: int, payload: dict) -> None:
        self.streams.setdefault(payload["stream_id"], StreamState())

    def append_assistant_message_chunk(self, run_id: int, payload: dict) -> None:
        stream = self.streams[payload["stream_id"]]
        seq = payload["sequence_no"]
        incoming = (payload["idempotency_key"], payload["content"])
        if seq in stream.chunks:
            if stream.chunks[seq] != incoming:
                raise RuntimeError("同序异文或同键异文，拒绝静默覆盖")
            return  # 同键同文：确定性重放，幂等去重
        if seq != len(stream.chunks) + 1:
            raise RuntimeError("分块序号不连续")
        stream.chunks[seq] = incoming

    def complete_assistant_message(self, run_id: int, payload: dict) -> None:
        stream = self.streams[payload["stream_id"]]
        full_text = "".join(
            stream.chunks[seq][1] for seq in sorted(stream.chunks)
        )
        assert sha256_text(full_text) == payload["content_digest"], "全文 digest 不符"
        assert payload["final_sequence_no"] == len(stream.chunks), "存在缺块"
        stream.completed = (payload["content_digest"], payload["final_sequence_no"])

    def abort_assistant_message(self, run_id: int, payload: dict) -> dict:
        self.streams[payload["stream_id"]].abort_reason = payload["reason_code"]
        # 观测面不建模发布门：任何前缀都未放行（released_sequence_no=0）。
        return {"released_sequence_no": 0}

    # ---- 观测面 ----

    def released_text(self, stream_id: str) -> str:
        """发布门视角：只有 completed 且未 abort 的流才有可见文本。"""
        stream = self.streams[stream_id]
        if stream.completed is None or stream.abort_reason is not None:
            return ""
        return "".join(stream.chunks[seq][1] for seq in sorted(stream.chunks))


class StreamObservationTest(unittest.TestCase):
    def test_online_reception_is_complete_without_duplicates_or_gaps(self) -> None:
        long_text = "观测" * 100  # 200 字符 → 3 满窗 + 尾块
        gateway = ObservingRunGateway(_fake_work())

        AgentWorker(gateway, _StaticOrchestrator(_static_result(long_text))).run_once()

        (stream_id,) = gateway.streams.keys()
        stream = gateway.streams[stream_id]
        self.assertEqual(long_text, gateway.released_text(stream_id))
        self.assertEqual([1, 2, 3, 4], sorted(stream.chunks))
        self.assertEqual(4, len({key for key, _ in stream.chunks.values()}))
        self.assertEqual(
            long_text, gateway.commit_payload["visible_text"]
        )

    def test_reconnect_replay_is_idempotent_and_divergent_replay_rejected(self) -> None:
        long_text = "重放" * 100
        gateway = ObservingRunGateway(_fake_work())
        AgentWorker(gateway, _StaticOrchestrator(_static_result(long_text))).run_once()
        (stream_id,) = gateway.streams.keys()
        stream = gateway.streams[stream_id]

        # 断线重放：同键同文 → 幂等去重，无重复无缺块。
        for seq, (key, content) in list(stream.chunks.items()):
            gateway.append_assistant_message_chunk(
                self.work_run_id,
                {
                    "stream_id": stream_id,
                    "idempotency_key": key,
                    "sequence_no": seq,
                    "content": content,
                },
            )
        self.assertEqual(4, len(stream.chunks))
        self.assertEqual(long_text, gateway.released_text(stream_id))

        # 同序同键异文 → 拒绝（F3：非确定性重放绝不静默覆盖）。
        key, _ = stream.chunks[1]
        with self.assertRaisesRegex(RuntimeError, "拒绝"):
            gateway.append_assistant_message_chunk(
                self.work_run_id,
                {
                    "stream_id": stream_id,
                    "idempotency_key": key,
                    "sequence_no": 1,
                    "content": "被篡改的内容",
                },
            )
        self.assertEqual(long_text, gateway.released_text(stream_id))

    work_run_id = 23  # _fake_work().agent_run_id

    def test_f1_abort_releases_nothing_and_retry_rebuilds_full_stream(self) -> None:
        # F1 整流重建：混流轮 abort（不释放文本）→ 新 stream_id 重放同文并完成——
        # 在线接收与重放一致、无重复无缺块，动作不丢失。
        gateway = ObservingRunGateway(_pydantic_work())
        orchestrator = PydanticAIOrchestrator(
            streaming_model(image_proposal_model), _bundle_source()
        )

        AgentWorker(gateway, orchestrator).run_once()

        self.assertEqual(2, len(gateway.streams))
        states = list(gateway.streams.items())
        (aborted_id, aborted), (retried_id, retried) = states
        self.assertEqual("PROTOCOL_MIXED_STREAM", aborted.abort_reason)
        self.assertEqual("", gateway.released_text(aborted_id))
        self.assertEqual(
            "好的，为你生成图片。", gateway.released_text(retried_id)
        )
        self.assertEqual(
            "好的，为你生成图片。", gateway.commit_payload["visible_text"]
        )
        self.assertEqual(1, len(gateway.commit_payload["actions"]))
        self.assertEqual(
            retried_id, gateway.commit_payload["assistant_message_stream_id"]
        )


if __name__ == "__main__":
    unittest.main()
