import asyncio
import json
import logging
import signal
import threading
from typing import Any, Mapping, Optional
from uuid import uuid4

from .contracts import (
    AgentRunConflictError,
    ChunkDeliveryError,
    MixedStreamError,
    OrchestratorPort,
    OrchestratorResult,
    RunGateway,
    RunWork,
    RuntimeCheckpoint,
    StreamAttemptExhaustedError,
)
from .streaming import CHUNK_WINDOW, operation_idempotency_key, sha256_text

logger = logging.getLogger("blue_whale_agent_worker")

# IK3GIM 回复流尝试 abort 的规范化 reason code（契约 §3.3）。
# LEASE_TAKEOVER / SUPERSEDED 是 Java 兜底码，不由 Worker 发出。
ABORT_REASON_CANCELLED = "CANCELLED"
ABORT_REASON_DISCONNECT = "DISCONNECT"
ABORT_REASON_PROTOCOL_MIXED_STREAM = "PROTOCOL_MIXED_STREAM"

# 契约 §2.1：同一 AgentRun 最多 2 个顺序尝试，额度由 F1（混流规范轮重试）与
# F3（取消/断连重跑）共用；单次 run_once 内本地计数最多 2 次模型调用。
MAX_STREAM_ATTEMPTS_PER_RUN = 2

# ADR-0043 规范化失败码：回复流尝试额度用尽（本地计数或 Java 100305 权威防线），
# 不再调用模型，经 error commit 通道使 Run 进入 failed。
ERROR_ASSISTANT_STREAM_ATTEMPT_EXHAUSTED = "ASSISTANT_STREAM_ATTEMPT_EXHAUSTED"


class StreamInterruptedError(BaseException):
    """SIGTERM/SIGINT 中断（F3）：流进行中取消，先幂等 abort 整流再退出。

    继承 BaseException（对齐 KeyboardInterrupt / CancelledError）：不被任何
    except Exception 归一化通道吞没，只能被 Worker 的 F3 处理路径显式捕获。
    """


class AgentWorker:
    def __init__(self, gateway: RunGateway, orchestrator: OrchestratorPort) -> None:
        self._gateway = gateway
        self._orchestrator = orchestrator

    def run_once(self) -> None:
        work: Optional[RunWork] = None
        try:
            work = self._gateway.claim()
            self._run_with_signal_handlers(work)
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
        except StreamInterruptedError as error:
            # F3：收到 SIGTERM/SIGINT——当前尝试已在内部幂等 abort（CANCELLED），
            # 打一条结构化 warn 日志后正常退出；abort 未送达由 Java LEASE_TAKEOVER
            # 兜底（契约 §4），此处不再提交任何状态。
            logger.warning(
                json.dumps(
                    {
                        "event": "agent_run_stream_interrupted",
                        "agent_run_id": None if work is None else work.agent_run_id,
                        "message": str(error),
                    },
                    ensure_ascii=False,
                )
            )

    def _run_with_signal_handlers(self, work: RunWork) -> None:
        # F3：租约有效期内收到 SIGTERM/SIGINT 时把中断转成 StreamInterruptedError，
        # 由流式编排先幂等 abort 再退出。仅主线程可安装信号处理（嵌入 / 测试场景
        # 退化为直接驱动）；处理完即恢复原处理器，不污染宿主进程。
        if threading.current_thread() is not threading.main_thread():
            asyncio.run(self._advance_and_commit(work))
            return

        def _handler(signum: int, _frame: Any) -> None:
            raise StreamInterruptedError(f"收到信号 {signum}，中断当前回复流尝试")

        previous = {
            sig: signal.signal(sig, _handler)
            for sig in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            asyncio.run(self._advance_and_commit(work))
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)

    async def _advance_and_commit(self, work: RunWork) -> None:
        run_binding = {
            "project_id": work.project_id,
            "user_id": work.user_id,
            "expected_run_version": work.run_version,
            "fencing_token": work.fencing_token,
            "engine": work.engine,
            "engine_version": work.engine_version,
            "adapter_schema_version": work.adapter_schema_version,
        }
        prior_text: Optional[str] = None
        attempt = 0
        stream_id: Optional[str] = None
        stream_open = False
        # 工单验收：commit 的 usage 覆盖所有真实发生的尝试——混流轮 raise 后其
        # usage 随 MixedStreamError 携带，聚合进最终 commit（求和而非覆盖）。
        prior_usages: list[Mapping[str, Any]] = []
        try:
            while True:
                # 每次执行即一次新回复流尝试：分配本尝试专用的不透明 stream_id，
                # 本尝试的 start/chunk/complete/commit 全部复用它；F1 重跑必换新 ID
                # （契约 §1.2）。跨进程恢复不续写旧流，从 checkpoint 重新推进。
                stream_id = self._stream_id()
                attempt += 1
                try:
                    self._gateway.start_assistant_message(
                        work.agent_run_id,
                        {
                            **run_binding,
                            "stream_id": stream_id,
                            "idempotency_key": operation_idempotency_key(
                                work.agent_run_id, "start"
                            ),
                        },
                    )
                except StreamAttemptExhaustedError:
                    # 契约 §2.3：Java 权威防线（跨进程恢复时本地计数不可知）——
                    # 不再调用模型，规范化 error commit 使 Run 进入 failed。
                    self._commit_attempt_exhausted(work, prior_usages)
                    return
                stream_open = True
                streamed: list[str] = []

                def emit_chunk(chunk: Mapping[str, Any]) -> None:
                    streamed.append(chunk["content"])
                    try:
                        self._gateway.append_assistant_message_chunk(
                            work.agent_run_id, {**run_binding, **chunk}
                        )
                    except (
                        AgentRunConflictError,
                        StreamAttemptExhaustedError,
                        StreamInterruptedError,
                    ):
                        raise
                    except Exception as error:
                        raise ChunkDeliveryError(str(error)) from error

                try:
                    result = await self._orchestrator.advance(
                        work,
                        stream_id=stream_id,
                        emit_chunk=emit_chunk,
                        f1_retry_prior_text=prior_text,
                    )
                except MixedStreamError as error:
                    # F1（契约 §3.3）：混流轮 fail closed——abort 本尝试，新
                    # stream_id 纯动作轮重试，动作不得静默丢失；重试轮仍混流
                    # 则额度用尽，不再调用模型，走规范化失败。契约 §3.2：abort
                    # 保留已放行前缀（aborted 消息对用户可见），故重试轮只承接
                    # 未放行尾部——按 abort 响应的 released_sequence_no × 64
                    # （流式期间 chunk 全是 64 字符满窗块）截取，不重复重放前缀。
                    abort_response = self._abort_best_effort(
                        work,
                        run_binding,
                        stream_id,
                        ABORT_REASON_PROTOCOL_MIXED_STREAM,
                    )
                    stream_open = False
                    if error.usage is not None:
                        prior_usages.append(error.usage)
                    prior_text = self._unreleased_tail(
                        error.streamed_text, abort_response
                    )
                    if attempt >= MAX_STREAM_ATTEMPTS_PER_RUN:
                        self._commit_attempt_exhausted(work, prior_usages)
                        return
                    continue
                self._gateway.complete_assistant_message(
                    work.agent_run_id,
                    {
                        **run_binding,
                        "stream_id": stream_id,
                        "idempotency_key": operation_idempotency_key(
                            work.agent_run_id, "complete"
                        ),
                        "final_sequence_no": len(streamed),
                        "content_digest": sha256_text(result.visible_text),
                    },
                )
                stream_open = False
                commit_payload = result.to_commit_payload(work, stream_id)
                for prior_usage in prior_usages:
                    commit_payload["usage"] = self._merge_usage(
                        prior_usage, commit_payload["usage"]
                    )
                self._gateway.commit(work.agent_run_id, commit_payload)
                return
        except (StreamInterruptedError, asyncio.CancelledError):
            # F3：流进行中取消——先幂等 abort（CANCELLED）再退出；abort 未送达
            # 由 Java LEASE_TAKEOVER 兜底（契约 §4）。
            if stream_open:
                self._abort_best_effort(
                    work, run_binding, stream_id, ABORT_REASON_CANCELLED
                )
            raise
        except (AgentRunConflictError, StreamAttemptExhaustedError):
            # 冲突分类语义独立（确定性退出 / Java 权威防线），不做 DISCONNECT abort。
            raise
        except Exception:
            # F3：流式期间 gateway 传输错误（含 ChunkDeliveryError）——best-effort
            # abort（DISCONNECT）后原样抛出，维持崩溃重试语义。
            if stream_open:
                self._abort_best_effort(
                    work, run_binding, stream_id, ABORT_REASON_DISCONNECT
                )
            raise

    def _commit_attempt_exhausted(
        self, work: RunWork, prior_usages: list[Mapping[str, Any]]
    ) -> None:
        # 契约 §2.3 / ADR-0043：尝试额度用尽的规范化 error commit——不再调用模型、
        # 不再开新尝试（commit 不携带 assistant_message_stream_id），Run 进入 failed。
        # usage 聚合所有真实发生的尝试（工单验收：用量不随失败尝试丢失）。
        usage = None
        for prior_usage in prior_usages:
            usage = self._merge_usage(prior_usage, usage)
        result = OrchestratorResult(
            commit_id=f"worker-exhausted-{work.agent_run_id}-{work.run_version}",
            visible_text="编排暂时无法继续。",
            checkpoint=work.checkpoint
            or RuntimeCheckpoint(
                engine=work.engine,
                engine_version=work.engine_version,
                adapter_schema_version=work.adapter_schema_version,
                opaque_payload={},
            ),
            actions=(),
            usage=usage,
            error={
                "code": ERROR_ASSISTANT_STREAM_ATTEMPT_EXHAUSTED,
                "message": "回复流尝试额度已用尽，不再调用模型。",
            },
        )
        self._gateway.commit(work.agent_run_id, result.to_commit_payload(work))

    @staticmethod
    def _merge_usage(base: Any, extra: Any) -> dict:
        # 用量字段求和而非覆盖（工单验收：usage 覆盖所有真实发生的尝试）。
        merged = dict(base) if base else {}
        for key in ("input_units", "output_units", "requests"):
            merged[key] = int(merged.get(key) or 0) + int(
                (extra or {}).get(key) or 0
            )
        return merged

    @staticmethod
    def _unreleased_tail(streamed_text: str, abort_response: Any) -> str:
        """截取混流轮文本的未放行尾部（契约 §3.2：已放行前缀保留在 aborted 消息
        中对用户可见，新尝试只承接尾部，不得重复重放）。

        流式期间 append 的 chunk 全是 64 字符满窗块（尾块只在 finish 落库），故
        已放行字符数 = released_sequence_no × 64。abort 未送达（响应为 None）时
        不做尾部推算：重试 start 会因遗留活动尝试冲突走既有 AgentRunConflictError
        路径（Java LEASE_TAKEOVER 兜底），此处按全文承接。released_sequence_no 缺失
        视为 0（不放行任何前缀，保守不丢文本）；released_chars 超过已流出长度属
        数据不一致，fail closed 取空尾部，由重试轮的既有空文本校验归一化失败。
        """
        if abort_response is None:
            return streamed_text
        released_sequence_no = abort_response.get("released_sequence_no") or 0
        released_chars = int(released_sequence_no) * CHUNK_WINDOW
        if released_chars > len(streamed_text):
            return ""
        return streamed_text[released_chars:]

    def _abort_best_effort(
        self,
        work: RunWork,
        run_binding: dict,
        stream_id: Optional[str],
        reason_code: str,
    ) -> Optional[Any]:
        # best-effort abort（契约 §3）：送达失败不打断主路径——Java 在租约接管时
        # 原子兜底收口遗留活动尝试（LEASE_TAKEOVER）。幂等键按尝试派生，重放同键。
        # 返回 AssistantMessageStreamResponse（含 released_sequence_no），未送达返回 None。
        try:
            return self._gateway.abort_assistant_message(
                work.agent_run_id,
                {
                    **run_binding,
                    "stream_id": stream_id,
                    "idempotency_key": operation_idempotency_key(
                        work.agent_run_id, f"abort:{stream_id}"
                    ),
                    "reason_code": reason_code,
                },
            )
        except Exception:
            logger.warning(
                json.dumps(
                    {
                        "event": "assistant_stream_abort_undelivered",
                        "agent_run_id": work.agent_run_id,
                        "stream_id": stream_id,
                        "reason_code": reason_code,
                    },
                    ensure_ascii=False,
                )
            )
            return None

    @staticmethod
    def _stream_id() -> str:
        # 契约 §1.2：stream_id 是每次尝试新生成的不透明标识，不得可从 AgentRun ID
        # 推导；同一尝试的传输重试复用它，abort 后的新尝试必须使用新 ID。
        return f"assistant-{uuid4().hex}"
