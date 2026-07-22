import hashlib
import json
import logging
from typing import Optional

from .contracts import OrchestratorPort, RunGateway, RunWork
from .http_gateway import AgentRunConflictError

logger = logging.getLogger("blue_whale_agent_worker")

# 可见文本切块大小（字符数）：编排器一次性给出全文，worker 按定长窗口切成多块
# 走完整分块协议（逐块审核、前缀放行），定长切分保证租约重领后的重放确定性。
TEXT_CHUNK_SIZE = 64


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
        stream_id = self._stream_id(work.agent_run_id)
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
    def _stream_id(run_id: int) -> str:
        return f"assistant-{run_id}"

    @staticmethod
    def _idempotency_key(run_id: int, operation: str) -> str:
        identity = f"{run_id}:{operation}".encode("utf-8")
        return f"assistant-{hashlib.sha256(identity).hexdigest()[:54]}"
