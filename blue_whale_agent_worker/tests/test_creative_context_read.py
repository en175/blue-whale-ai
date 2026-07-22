import unittest

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from blue_whale_agent_worker.bundle.errors import (
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    BundleError,
)
from blue_whale_agent_worker.contracts import ToolGrant
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator

from test_pydantic_orchestrator import _bundle_source, _pydantic_work


def _creative_grant(tool_name: str) -> ToolGrant:
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


class _FakeCreativeContextSource:
    """记录 fetch 调用、返回可控创作现场数据的 CreativeContextSource 桩。"""

    def __init__(self) -> None:
        self.canvas_nodes_calls: list[tuple] = []
        self.canvas_node_calls: list[tuple] = []
        self.asset_calls: list[tuple] = []
        self.job_status_calls: list[tuple] = []
        self.creative_skills_calls: list[int] = []
        self.asset_payload: dict = {"asset_id": 5, "type": "image", "status": "normal"}

    def fetch_canvas_nodes(self, run_id, limit=None):
        self.canvas_nodes_calls.append((run_id, limit))
        return {"canvas_id": 91, "nodes": [{"node_id": "n1", "type": "asset", "asset_id": 5}]}

    def fetch_canvas_node(self, run_id, node_id):
        self.canvas_node_calls.append((run_id, node_id))
        return {"node_id": node_id, "type": "asset", "asset_id": 5, "data": {"asset_id": 5}}

    def fetch_asset(self, run_id, asset_id):
        self.asset_calls.append((run_id, asset_id))
        return self.asset_payload

    def fetch_generation_job_status(self, run_id, job_id):
        self.job_status_calls.append((run_id, job_id))
        return {"job_id": job_id, "type": "image", "status": "succeeded", "progress": 100}

    def fetch_creative_skills(self, run_id):
        self.creative_skills_calls.append(run_id)
        return [
            {
                "creative_skill_id": "cs1",
                "version": "1.0.0",
                "name": "海报风格",
                "description": "生成海报",
                "allow_implicit_invocation": True,
            }
        ]


def _tool_then_text_model(tool_name, args=None):
    """先发起一次 tool_name 调用，工具返回后输出文本。"""
    args = args or {}

    def model(messages, info):
        if not any(
            isinstance(part, ToolReturnPart)
            for message in messages
            for part in message.parts
        ):
            return ModelResponse(parts=(ToolCallPart(tool_name, args, "call-1"),))
        return ModelResponse(parts=(TextPart("已读取创作现场"),))

    return model


def _context_evidence(evidence):
    """bundle_evidence 中筛出创作现场读取证据（origin=conversation）。"""
    return [e for e in evidence if e["origin"] == "conversation"]


class CreativeContextChargeTest(unittest.TestCase):
    """创作现场读取复用 ResourceGate.charge_conversation 同一账本（origin=conversation）。"""

    def test_charge_appends_context_evidence(self) -> None:
        # 直接复用 IK2QBZ 的 charge_conversation 通道，验证 context:* resource_id 落账。
        from test_bundle_gate import _gate

        gate = _gate(initial_tokens=0)
        gate.charge_conversation("context:7:asset:5", "hello world")
        evidence = [e for e in gate.evidence() if e.origin == "conversation"]
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0].resource_id, "context:7:asset:5")
        # "hello world" = 11 chars → max(1,(11+3)//4) = 3
        self.assertEqual(evidence[0].token_estimate, 3)

    def test_charge_exceeding_single_budget_fails_closed(self) -> None:
        from test_bundle_gate import _gate

        gate = _gate(initial_tokens=0, single_max=5)
        with self.assertRaises(BundleError) as cm:
            gate.charge_conversation("context:7:canvas_nodes", "x" * 100)
        self.assertEqual(cm.exception.code, BUNDLE_TOKEN_BUDGET_EXCEEDED)


class CreativeContextReadToolTest(unittest.TestCase):
    def test_list_canvas_nodes_calls_source_and_records_evidence(self) -> None:
        ctx = _FakeCreativeContextSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("list_canvas_nodes")),
            _bundle_source(),
            creative_context_source=ctx,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "画布上有啥"},),
                tool_grants=(_creative_grant("list_canvas_nodes"),),
            )
        )
        self.assertIsNone(result.error)
        self.assertEqual(ctx.canvas_nodes_calls, [(23, None)])
        evidence = _context_evidence(result.bundle_evidence)
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["resource_id"], "context:7:canvas_nodes")

    def test_read_canvas_node_passes_node_id(self) -> None:
        ctx = _FakeCreativeContextSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("read_canvas_node", {"node_id": "n1"})),
            _bundle_source(),
            creative_context_source=ctx,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "看那个节点"},),
                tool_grants=(_creative_grant("read_canvas_node"),),
            )
        )
        self.assertIsNone(result.error)
        self.assertEqual(ctx.canvas_node_calls, [(23, "n1")])
        evidence = _context_evidence(result.bundle_evidence)
        self.assertEqual(evidence[0]["resource_id"], "context:7:canvas_node:n1")

    def test_read_asset_passes_asset_id(self) -> None:
        ctx = _FakeCreativeContextSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("read_asset", {"asset_id": 5})),
            _bundle_source(),
            creative_context_source=ctx,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "那张图啥样"},),
                tool_grants=(_creative_grant("read_asset"),),
            )
        )
        self.assertIsNone(result.error)
        self.assertEqual(ctx.asset_calls, [(23, 5)])
        evidence = _context_evidence(result.bundle_evidence)
        self.assertEqual(evidence[0]["resource_id"], "context:7:asset:5")

    def test_read_generation_job_status_passes_job_id(self) -> None:
        ctx = _FakeCreativeContextSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("read_generation_job_status", {"job_id": 9})),
            _bundle_source(),
            creative_context_source=ctx,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "图好了吗"},),
                tool_grants=(_creative_grant("read_generation_job_status"),),
            )
        )
        self.assertIsNone(result.error)
        self.assertEqual(ctx.job_status_calls, [(23, 9)])
        evidence = _context_evidence(result.bundle_evidence)
        self.assertEqual(evidence[0]["resource_id"], "context:7:job_status:9")

    def test_list_creative_skills_calls_source(self) -> None:
        ctx = _FakeCreativeContextSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("list_creative_skills")),
            _bundle_source(),
            creative_context_source=ctx,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "有哪些技能"},),
                tool_grants=(_creative_grant("list_creative_skills"),),
            )
        )
        self.assertIsNone(result.error)
        self.assertEqual(ctx.creative_skills_calls, [23])
        evidence = _context_evidence(result.bundle_evidence)
        self.assertEqual(evidence[0]["resource_id"], "context:7:creative_skills")


class CreativeContextBudgetAndGrantTest(unittest.TestCase):
    def test_read_asset_exceeding_single_budget_fails_closed(self) -> None:
        # json.dumps 后超 singleResourceMaxTokens(1000) → fail closed，error 归一化。
        ctx = _FakeCreativeContextSource()
        ctx.asset_payload = {"asset_id": 5, "blob": "x" * 8000}
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("read_asset", {"asset_id": 5})),
            _bundle_source(),
            creative_context_source=ctx,
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读素材"},),
                tool_grants=(_creative_grant("read_asset"),),
            )
        )
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error["code"], BUNDLE_TOKEN_BUDGET_EXCEEDED)

    def test_grant_effect_mismatch_fails_closed(self) -> None:
        ctx = _FakeCreativeContextSource()
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("read_asset", {"asset_id": 5})),
            _bundle_source(),
            creative_context_source=ctx,
        )
        mismatch = ToolGrant(
            tool_name="read_asset",
            registry_version=1,
            effect="side_effect",
            proposal_only=True,
            argument_schema={"type": "object"},
            constraints={},
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读素材"},),
                tool_grants=(mismatch,),
            )
        )
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error["code"], "ORCHESTRATOR_CONTRACT_MISMATCH")

    def test_unknown_creative_tool_fails_closed(self) -> None:
        # 授权表里没有 read_asset 时（source 未注入）工具不可见 → grant 不匹配。
        orch = PydanticAIOrchestrator(
            FunctionModel(_tool_then_text_model("read_asset", {"asset_id": 5})),
            _bundle_source(),
        )
        result = orch.advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读素材"},),
                tool_grants=(_creative_grant("read_asset"),),
            )
        )
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error["code"], "ORCHESTRATOR_CONTRACT_MISMATCH")


if __name__ == "__main__":
    unittest.main()
