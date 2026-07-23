import hashlib
import json
import logging
from typing import Optional
from uuid import uuid4

from .contracts import OrchestratorPort, RunGateway, RunWork
from .http_gateway import AgentRunConflictError

logger = logging.getLogger("blue_whale_agent_worker")

# 可见文本切块大小（字符数）：编排器一次性给出全文，worker 按定长窗口切成多块
# 走完整分块协议（逐块审核、前缀放行），定长切分保证租约重领后的重放确定性。
TEXT_CHUNK_SIZE = 64

# IK3GIM 回复流尝试 abort 的规范化 reason code（契约 §3.3）。
# LEASE_TAKEOVER / SUPERSEDED 是 Java 兜底码，不由 Worker 发出；
# F1/F3 的检测与重跑编排由 IK3BG3 实现，此处只冻结跨进程契约值。
ABORT_REASON_CANCELLED = "CANCELLED"
ABORT_REASON_DISCONNECT = "DISCONNECT"
ABORT_REASON_PROTOCOL_MIXED_STREAM = "PROTOCOL_MIXED_STREAM"


def _split_text_chunks(text: str) -> list[str]:
    if not text:
        return [""]
    return [text[index:index + TEXT_CHUNK_SIZE] for index in range(0, len(text), TEXT_CHUNK_SIZE)]


class AgentWorker:
    def __init__(self, gateway: RunGateway, orchestrator: OrchestratorPort) -> None:
        self._gateway = gateway
        self._orchestrator = orchestrator

    def run_once(self) -> None:
        work: Optional[RunWork] = None
        try:
            work = self._gateway.claim()
            self._advance_and_commit(work)
        except AgentRunConflictError as error:
            # IK3BG2：Run 被新目标取代（superseded）后旧 Worker 的任何写都被 409 拒绝——
            # 打一条结构化 warn 日志并正常返回（进程 exit 0），不再提交任何状态；
            # 其余错误维持现状冒泡（非零退出，由外层循环崩溃重试）。
            logger.warning(
                json.dumps(
                    {
                        "event": "agent_run_conflict",
                        "agent_run_id": None if work is None else work.agent_run_id,
                        "message": str(error),
                    },
                    ensure_ascii=False,
                )
            )

    def _advance_and_commit(self, work: RunWork) -> None:
        proposal = self._orchestrator.advance(work)
        # 每次执行即一次新回复流尝试：分配本尝试专用的不透明 stream_id，
        # 本尝试的 start/chunk/complete/commit 全部复用它。
        stream_id = self._stream_id()
        run_binding = {
            "project_id": work.project_id,
            "user_id": work.user_id,
            "expected_run_version": work.run_version,
            "fencing_token": work.fencing_token,
            "engine": work.engine,
            "engine_version": work.engine_version,
            "adapter_schema_version": work.adapter_schema_version,
        }
        self._gateway.start_assistant_message(
            work.agent_run_id,
            {
                **run_binding,
                "stream_id": stream_id,
                "idempotency_key": self._idempotency_key(
                    work.agent_run_id, "start"
                ),
            },
        )
        review_evidence = {
            "source": (
                "local-fake" if work.engine == "fake" else "worker-prefix"
            )
        }
        chunks = _split_text_chunks(proposal.visible_text)
        for sequence_no, content in enumerate(chunks, start=1):
            self._gateway.append_assistant_message_chunk(
                work.agent_run_id,
                {
                    **run_binding,
                    "stream_id": stream_id,
                    "idempotency_key": self._idempotency_key(
                        work.agent_run_id, f"chunk:{sequence_no}"
                    ),
                    "sequence_no": sequence_no,
                    "content": content,
                    "review_evidence": review_evidence,
                },
            )
        self._gateway.complete_assistant_message(
            work.agent_run_id,
            {
                **run_binding,
                "stream_id": stream_id,
                "idempotency_key": self._idempotency_key(
                    work.agent_run_id, "complete"
                ),
                "final_sequence_no": len(chunks),
                "content_digest": hashlib.sha256(
                    proposal.visible_text.encode("utf-8")
                ).hexdigest(),
            },
        )
        self._gateway.commit(
            work.agent_run_id,
            proposal.to_commit_payload(work, stream_id),
        )

    @staticmethod
    def _stream_id() -> str:
        # 契约 §1.2：stream_id 是每次尝试新生成的不透明标识，不得可从 AgentRun ID
        # 推导；同一尝试的传输重试复用它，abort 后的新尝试必须使用新 ID。
        return f"assistant-{uuid4().hex}"

    @staticmethod
    def _idempotency_key(run_id: int, operation: str) -> str:
        identity = f"{run_id}:{operation}".encode("utf-8")
        return f"assistant-{hashlib.sha256(identity).hexdigest()[:54]}"
