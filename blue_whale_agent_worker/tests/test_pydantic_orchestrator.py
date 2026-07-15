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


def failing_model(messages, info):
    raise RuntimeError("provider-secret=sk-test file=/tmp/private-prompt")


def unsafe_text_model(messages, info):
    return ModelResponse(
        parts=(TextPart("Pydantic RunContext read /tmp/private-prompt"),)
    )


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


class PydanticAIOrchestratorTest(unittest.TestCase):
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
        self.assertEqual("generate_image", payload["actions"][0]["action_type"])
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

    def test_initial_text_without_the_required_image_action_fails_closed(self) -> None:
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
            messages=({"role": "user", "content": "说明执行情况"},),
            checkpoint=None,
        )

        result = PydanticAIOrchestrator(FunctionModel(unsafe_text_model)).advance(work)

        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertEqual("编排暂时无法继续。", result.visible_text)

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
