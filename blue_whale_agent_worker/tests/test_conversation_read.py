import unittest

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from blue_whale_agent_worker.bundle.errors import (
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    BundleError,
)
from blue_whale_agent_worker.contracts import ToolGrant
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator

from test_bundle_gate import _gate
from test_pydantic_orchestrator import _bundle_source, _pydantic_work


def _read_grant(tool_name: str = "read_conversation_summary") -> ToolGrant:
    return ToolGrant(
        tool_name=tool_name,
        registry_version=1,
        effect="read",
        proposal_only=True,
        argument_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
        },
        constraints={},
    )


class _FakeConversationSource:
    """记录 fetch 调用、返回可控摘要 / 历史的 ConversationSource 桩。"""

    def __init__(self, summary=None, history=None) -> None:
        self.summary = summary if summary is not None else {
            "conversation_id": 11,
            "message_count": 2,
            "first_user_preview": "画蓝鲸",
            "last_message_preview": "好的",
        }
        self.history = history if history is not None else {
            "conversation_id": 11,
            "items": [{"sequence_no": 1, "role": "user", "content": "画蓝鲸"}],
            "next_cursor": None,
            "has_more": False,
        }
        self.summary_calls: list[int] = []
        self.history_calls: list[tuple] = []

    def fetch_conversation_summary(self, run_id):
        self.summary_calls.append(run_id)
        return self.summary

    def fetch_conversation_history(self, run_id, after=None, limit=20):
        self.history_calls.append((run_id, after, limit))
        return self.history


def _summary_then_text_model(messages, info):
    if not any(
        isinstance(part, ToolReturnPart) for message in messages for part in message.parts
    ):
        return ModelResponse(
            parts=(ToolCallPart("read_conversation_summary", {}, "summary-call"),)
        )
    return ModelResponse(parts=(TextPart("已读取对话摘要"),))


def _conversation_evidence(evidence):
    """bundle_evidence 统一通道中筛出对话读取证据（origin=conversation）。"""
    return [e for e in evidence if e["origin"] == "conversation"]


class ConversationChargeTest(unittest.TestCase):
    """对话读取记账复用 ResourceGate 同一双预算门与账本（origin=conversation）。"""

    def test_charge_appends_conversation_evidence(self) -> None:
        gate = _gate(initial_tokens=0)
        gate.charge_conversation("conversation:11:summary", "hello world")
        evidence = [e for e in gate.evidence() if e.origin == "conversation"]
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0].revision, 0)
        self.assertEqual(evidence[0].resource_id, "conversation:11:summary")
        self.assertTrue(evidence[0].content_digest.startswith("sha256:"))
        # "hello world" = 11 chars → max(1,(11+3)//4) = 3
        self.assertEqual(evidence[0].token_estimate, 3)

    def test_charge_exceeding_single_resource_fails_closed(self) -> None:
        gate = _gate(initial_tokens=0, single_max=5)
        with self.assertRaises(BundleError) as cm:
            gate.charge_conversation("conversation:11:summary", "x" * 100)
        self.assertEqual(cm.exception.code, BUNDLE_TOKEN_BUDGET_EXCEEDED)

    def test_charge_exceeding_active_context_fails_closed(self) -> None:
        gate = _gate(initial_tokens=0, active_max=10, single_max=100000)
        gate.charge_conversation("conversation:11:summary", "abcd")  # 1 token, active=1
        with self.assertRaises(BundleError) as cm:
            # 25 tokens, 1 + 25 > 10
            gate.charge_conversation("conversation:11:history", "x" * 100)
        self.assertEqual(cm.exception.code, BUNDLE_TOKEN_BUDGET_EXCEEDED)

    def test_charge_counts_into_same_active_ledger_as_bundle_resources(self) -> None:
        # 对话读取与 Bundle 资源读取共享同一活动上下文累计：基线 40，读 25 tokens
        # 的对话后活动用量 65；第二次 25 tokens → 65+25>65 fail closed。
        gate = _gate(initial_tokens=40, active_max=65, single_max=100000)
        gate.charge_conversation("conversation:11:summary", "x" * 100)
        with self.assertRaises(BundleError) as cm:
            gate.charge_conversation("conversation:11:history", "x" * 100)
        self.assertEqual(cm.exception.code, BUNDLE_TOKEN_BUDGET_EXCEEDED)


class ReadConversationSummaryToolTest(unittest.TestCase):
    def test_summary_tool_records_evidence_and_calls_source(self) -> None:
        conv = _FakeConversationSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_summary_then_text_model),
            _bundle_source(),
            conversation_source=conv,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读摘要"},),
                tool_grants=(_read_grant("read_conversation_summary"),),
            )
        )
        self.assertIsNone(result.error)
        self.assertEqual(conv.summary_calls, [23])  # agent_run_id
        evidence = _conversation_evidence(result.bundle_evidence)
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["resource_id"], "conversation:11:summary")
        # 证据随 commit payload 经 bundle_evidence 统一通道上报
        payload = result.to_commit_payload(
            _pydantic_work(tool_grants=(_read_grant(),))
        )
        payload_evidence = _conversation_evidence(payload["bundle_evidence"])
        self.assertEqual(len(payload_evidence), 1)


class ReadConversationHistoryToolTest(unittest.TestCase):
    def test_history_tool_paginates_and_records_evidence(self) -> None:
        conv = _FakeConversationSource()

        def history_then_text_model(messages, info):
            tool_returns = [
                part for message in messages for part in message.parts
                if isinstance(part, ToolReturnPart)
            ]
            if len(tool_returns) < 2:
                args = {} if not tool_returns else {"after": 1, "limit": 5}
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_conversation_history", args, f"hist-{len(tool_returns)}"
                        ),
                    )
                )
            return ModelResponse(parts=(TextPart("已读取历史"),))

        orch = PydanticAIOrchestrator(
            FunctionModel(history_then_text_model),
            _bundle_source(),
            conversation_source=conv,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读历史"},),
                tool_grants=(_read_grant("read_conversation_history"),),
            )
        )
        self.assertIsNone(result.error)
        self.assertEqual(len(conv.history_calls), 2)
        evidence = _conversation_evidence(result.bundle_evidence)
        self.assertEqual(len(evidence), 2)
        ids = [e["resource_id"] for e in evidence]
        self.assertEqual(ids[0], "conversation:11:history")
        self.assertEqual(ids[1], "conversation:11:history:after:1")


class ReadConversationBudgetAndGrantTest(unittest.TestCase):
    def test_summary_exceeding_single_budget_fails_closed(self) -> None:
        # json.dumps 后约 2000 tokens > singleResourceMaxTokens(1000)
        huge = {"conversation_id": 11, "blob": "x" * 8000}
        conv = _FakeConversationSource(summary=huge)
        orch = PydanticAIOrchestrator(
            FunctionModel(_summary_then_text_model),
            _bundle_source(),
            conversation_source=conv,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读摘要"},),
                tool_grants=(_read_grant("read_conversation_summary"),),
            )
        )
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error["code"], BUNDLE_TOKEN_BUDGET_EXCEEDED)

    def test_grant_effect_mismatch_fails_closed(self) -> None:
        conv = _FakeConversationSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_summary_then_text_model),
            _bundle_source(),
            conversation_source=conv,
        )
        mismatch = ToolGrant(
            tool_name="read_conversation_summary",
            registry_version=1,
            effect="side_effect",
            proposal_only=True,
            argument_schema={"type": "object"},
            constraints={},
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读摘要"},),
                tool_grants=(mismatch,),
            )
        )
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error["code"], "ORCHESTRATOR_CONTRACT_MISMATCH")


if __name__ == "__main__":
    unittest.main()
