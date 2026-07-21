import json
import unittest

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from blue_whale_agent_worker.contracts import (
    AcceptedActionResult,
    RunWork,
    RuntimeCheckpoint,
)
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator


def image_proposal_model(messages, info):
    if any(
        isinstance(part, ToolReturnPart)
        for message in messages
        for part in message.parts
    ):
        return ModelResponse(parts=(TextPart("图片已经生成。"),))
    return ModelResponse(
        parts=(
            ToolCallPart(
                "generate_image",
                {"prompt": "蓝鲸海报", "aspect_ratio": "1:1"},
                "provider-private-call-id",
            ),
        )
    )


def reference_image_proposal_model(messages, info):
    return ModelResponse(
        parts=(
            ToolCallPart(
                "generate_image",
                {
                    "prompt": "把月亮加入参考图",
                    "aspect_ratio": "16:9",
                    "reference_asset_ids": [91, 92],
                },
                "provider-private-reference-call-id",
            ),
        )
    )


def size_and_web_search_proposal_model(messages, info):
    return ModelResponse(
        parts=(
            ToolCallPart(
                "generate_image",
                {
                    "prompt": "联网生成一张 2K 蓝鲸海报",
                    "size": "2K",
                    "web_search": True,
                },
                "provider-private-size-call-id",
            ),
        )
    )


def failing_model(messages, info):
    raise RuntimeError("provider-secret=sk-test file=/tmp/private-prompt")


def unsafe_resume_model(messages, info):
    if any(
        isinstance(part, ToolReturnPart)
        for message in messages
        for part in message.parts
    ):
        return ModelResponse(
            parts=(TextPart("provider-secret=sk-private-user-prompt=蓝鲸海报"),)
        )
    return image_proposal_model(messages, info)


def clarification_dialogue_model(messages, info):
    """首轮：意图缺少信息，模型用纯文本提出澄清问题；
    恢复：消息历史中已有自己的澄清问题，针对新回答提出单个生图动作。"""
    asked = any(
        isinstance(message, ModelResponse)
        and any(isinstance(part, TextPart) for part in message.parts)
        for message in messages
    )
    if not asked:
        return ModelResponse(parts=(TextPart("您希望什么风格和比例？"),))
    return ModelResponse(
        parts=(
            ToolCallPart(
                "generate_image",
                {"prompt": "蓝鲸海报，水墨风格带留白", "aspect_ratio": "1:1"},
                "clarification-resume-call-id",
            ),
        )
    )


def always_text_model(messages, info):
    return ModelResponse(parts=(TextPart("仍然缺少信息。"),))


class PydanticAIOrchestratorTest(unittest.TestCase):
    def test_production_adapter_can_propose_owned_reference_asset_ids(self) -> None:
        work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "参考素材生成海报"},),
            checkpoint=None,
        )

        result = PydanticAIOrchestrator(
            FunctionModel(reference_image_proposal_model)
        ).advance(work)

        self.assertEqual(
            [91, 92], result.actions[0].arguments["reference_asset_ids"]
        )

    def test_production_adapter_passes_through_size_and_web_search(self) -> None:
        work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "联网生成一张 2K 蓝鲸海报"},),
            checkpoint=None,
        )

        result = PydanticAIOrchestrator(
            FunctionModel(size_and_web_search_proposal_model)
        ).advance(work)
        payload = result.to_commit_payload(work)

        self.assertEqual("2K", payload["actions"][0]["arguments"]["size"])
        self.assertIs(True, payload["actions"][0]["arguments"]["web_search"])

    def test_production_adapter_returns_a_product_neutral_image_proposal(self) -> None:
        work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )

        result = PydanticAIOrchestrator(FunctionModel(image_proposal_model)).advance(work)
        payload = result.to_commit_payload(work)

        self.assertEqual("已接纳，正在生成图片。", payload["visible_text"])
        self.assertEqual("create_image_generation_job", payload["actions"][0]["tool_id"])
        self.assertEqual(
            {"prompt": "蓝鲸海报", "aspect_ratio": "1:1"},
            payload["actions"][0]["arguments"],
        )
        self.assertNotEqual(
            "provider-private-call-id", payload["actions"][0]["action_id"]
        )
        self.assertEqual("pydantic-ai", result.checkpoint.engine)
        self.assertEqual("2.9.0", result.checkpoint.engine_version)
        self.assertEqual(1, result.checkpoint.adapter_schema_version)
        json.dumps(payload, ensure_ascii=False)

    def test_deferred_image_result_resumes_in_a_new_adapter_instance(self) -> None:
        initial_work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )
        initial_result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model)
        ).advance(initial_work)
        restored_checkpoint = RuntimeCheckpoint(
            engine=initial_result.checkpoint.engine,
            engine_version=initial_result.checkpoint.engine_version,
            adapter_schema_version=initial_result.checkpoint.adapter_schema_version,
            opaque_payload=json.loads(
                json.dumps(initial_result.checkpoint.opaque_payload, ensure_ascii=False)
            ),
        )
        resumed_work = RunWork(
            **{
                **initial_work.__dict__,
                "run_version": 2,
                "fencing_token": 5,
                "checkpoint": restored_checkpoint,
                "accepted_results": (
                    AcceptedActionResult(
                        action_id=initial_result.actions[0].action_id,
                        status="succeeded",
                        result={"asset_ids": [91]},
                    ),
                ),
            }
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model)
        ).advance(resumed_work)

        self.assertEqual("图片已经生成。", resumed_result.visible_text)
        self.assertEqual((), resumed_result.actions)
        self.assertEqual(
            (), resumed_result.checkpoint.opaque_payload["pending_calls"]
        )

    def test_mismatched_or_corrupt_checkpoint_fails_closed(self) -> None:
        work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=2,
            fencing_token=5,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=RuntimeCheckpoint(
                engine="pydantic-ai",
                engine_version="2.8.0",
                adapter_schema_version=1,
                opaque_payload={"raw_secret": "checkpoint-private-value"},
            ),
        )

        result = PydanticAIOrchestrator(FunctionModel(image_proposal_model)).advance(work)
        serialized = json.dumps(result.to_commit_payload(work), ensure_ascii=False)

        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertEqual((), result.actions)
        self.assertNotIn("checkpoint-private-value", serialized)
        self.assertNotIn("2.8.0", serialized)

    def test_framework_exception_is_normalized_without_private_details(self) -> None:
        work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )

        result = PydanticAIOrchestrator(FunctionModel(failing_model)).advance(work)
        serialized = json.dumps(result.to_commit_payload(work), ensure_ascii=False)

        self.assertEqual("ORCHESTRATION_FAILED", result.error["code"])
        self.assertEqual("编排暂时无法继续。", result.visible_text)
        self.assertEqual((), result.actions)
        self.assertNotIn("sk-test", serialized)
        self.assertNotIn("/tmp/private-prompt", serialized)

    def test_engine_identity_mismatches_are_normalized(self) -> None:
        base = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )
        mismatches = (
            {"engine": "fake"},
            {"engine_version": "2.8.0"},
            {"adapter_schema_version": 2},
        )

        for mismatch in mismatches:
            with self.subTest(mismatch=mismatch):
                work = RunWork(**{**base.__dict__, **mismatch})
                result = PydanticAIOrchestrator(
                    FunctionModel(image_proposal_model)
                ).advance(work)

                self.assertEqual(
                    "ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"]
                )
                self.assertEqual((), result.actions)

    def test_initial_text_becomes_a_product_neutral_clarification_proposal(self) -> None:
        # 模型认为意图缺少推进生图所必需的信息时，初次推进的文本输出
        # 转换为产品中性的创作澄清提议（与动作互斥），不再视为契约违约。
        work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张"},),
            checkpoint=None,
        )

        result = PydanticAIOrchestrator(
            FunctionModel(clarification_dialogue_model)
        ).advance(work)
        payload = result.to_commit_payload(work)

        self.assertEqual((), result.actions)
        self.assertEqual([], payload["actions"])
        self.assertIsNotNone(result.input_request)
        proposal = payload["user_input_request"]
        self.assertEqual("creation_clarification", proposal["request_type"])
        self.assertEqual("您希望什么风格和比例？", proposal["question"])
        # 可见 Agent 消息与澄清问题一致。
        self.assertEqual("您希望什么风格和比例？", payload["visible_text"])
        # 澄清形态 checkpoint：无待处理动作，支持后续恢复。
        self.assertEqual((), result.checkpoint.opaque_payload["pending_calls"])
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("deferredtoolrequests", serialized.lower())
        self.assertNotIn("tool_call_id", serialized)

    def test_clarification_resume_proposes_a_single_image_action(self) -> None:
        initial_work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )
        initial_result = PydanticAIOrchestrator(
            FunctionModel(clarification_dialogue_model)
        ).advance(initial_work)
        self.assertIsNotNone(initial_result.input_request)
        restored_checkpoint = RuntimeCheckpoint(
            engine=initial_result.checkpoint.engine,
            engine_version=initial_result.checkpoint.engine_version,
            adapter_schema_version=initial_result.checkpoint.adapter_schema_version,
            opaque_payload=json.loads(
                json.dumps(initial_result.checkpoint.opaque_payload, ensure_ascii=False)
            ),
        )
        resumed_work = RunWork(
            **{
                **initial_work.__dict__,
                "run_version": 2,
                "fencing_token": 5,
                "messages": (
                    {"role": "user", "content": "生成一张蓝鲸海报"},
                    {"role": "assistant", "content": "您希望什么风格和比例？"},
                    {"role": "user", "content": "水墨风格带留白"},
                ),
                "checkpoint": restored_checkpoint,
            }
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(clarification_dialogue_model)
        ).advance(resumed_work)

        # 恢复后恰好一个内置 generate_image 动作，不再提出输入请求。
        self.assertIsNone(resumed_result.input_request)
        self.assertEqual(1, len(resumed_result.actions))
        self.assertEqual("create_image_generation_job", resumed_result.actions[0].tool_id)
        self.assertEqual(
            {"prompt": "蓝鲸海报，水墨风格带留白", "aspect_ratio": "1:1"},
            resumed_result.actions[0].arguments,
        )
        self.assertEqual("已接纳，正在生成图片。", resumed_result.visible_text)
        self.assertEqual(
            1, len(resumed_result.checkpoint.opaque_payload["pending_calls"])
        )

    def test_clarification_resume_text_fails_closed(self) -> None:
        # 澄清恢复后模型仍输出文本（未提出动作）：契约违约，失败关闭。
        initial_work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )
        initial_result = PydanticAIOrchestrator(
            FunctionModel(always_text_model)
        ).advance(initial_work)
        self.assertIsNotNone(initial_result.input_request)
        resumed_work = RunWork(
            **{
                **initial_work.__dict__,
                "run_version": 2,
                "fencing_token": 5,
                "messages": (
                    {"role": "user", "content": "生成一张蓝鲸海报"},
                    {"role": "assistant", "content": "仍然缺少信息。"},
                    {"role": "user", "content": "水墨风格"},
                ),
                "checkpoint": initial_result.checkpoint,
            }
        )

        result = PydanticAIOrchestrator(FunctionModel(always_text_model)).advance(
            resumed_work
        )

        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertEqual((), result.actions)
        self.assertIsNone(result.input_request)

    def test_resumed_model_text_is_replaced_by_fixed_product_copy(self) -> None:
        initial_work = RunWork(
            agent_run_id=23,
            project_id=7,
            conversation_id=11,
            user_id=10,
            run_version=1,
            fencing_token=4,
            engine="pydantic-ai",
            engine_version="2.9.0",
            adapter_schema_version=1,
            messages=({"role": "user", "content": "生成一张蓝鲸海报"},),
            checkpoint=None,
        )
        initial_result = PydanticAIOrchestrator(
            FunctionModel(unsafe_resume_model)
        ).advance(initial_work)
        resumed_work = RunWork(
            **{
                **initial_work.__dict__,
                "run_version": 2,
                "fencing_token": 5,
                "checkpoint": initial_result.checkpoint,
                "accepted_results": (
                    AcceptedActionResult(
                        action_id=initial_result.actions[0].action_id,
                        status="succeeded",
                        result={"asset_ids": [91]},
                    ),
                ),
            }
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(unsafe_resume_model)
        ).advance(resumed_work)

        self.assertEqual("图片已经生成。", resumed_result.visible_text)
        self.assertNotIn("sk-private", resumed_result.visible_text)


if __name__ == "__main__":
    unittest.main()
