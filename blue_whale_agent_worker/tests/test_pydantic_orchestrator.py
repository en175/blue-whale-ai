import hashlib
import json
import re
import unittest

from pydantic_ai import CallDeferred
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from blue_whale_agent_worker.bundle.canonical import manifest_digest
from blue_whale_agent_worker.bundle.source import FakeBundleSource
from blue_whale_agent_worker.contracts import (
    AcceptedActionResult,
    RunWork,
    RuntimeCheckpoint,
    ToolGrant,
)
from blue_whale_agent_worker.pydantic_orchestrator import (
    PydanticAIOrchestrator,
    ToolImplementation,
)

# ---- Bundle 基础上下文夹具（IK2QBJ：instructions 由装载后的 Bundle 驱动）----

BUNDLE_VERSION_ID = "pin_agent_v2_0_0"
MODEL_PROFILE_ID = "model_v2"
MODEL_PROFILE_VERSION = "2.0.0"
ROLE_DOCUMENT_BODY = "# 角色：蓝鲸创作导演\n你负责把用户创作意图推进到可生成。"


def _bundle_manifest() -> dict:
    return {
        "formatVersion": 1,
        "baseUri": f"bw-bundle://{BUNDLE_VERSION_ID}/",
        "digestAlgorithm": "sha256",
        "resources": [
            {
                "resourceId": "role_main",
                "revision": 1,
                "kind": "role_document",
                "path": "AGENTS.md",
                "mediaType": "text/markdown",
                "loadMode": "always_on",
                "contentDigest": "sha256:" + "0" * 64,
                "sizeBytes": len(ROLE_DOCUMENT_BODY),
                "tokenEstimate": 32,
                "references": [],
            }
        ],
    }


MANIFEST_DIGEST = manifest_digest(_bundle_manifest())


def _bundle_snapshot() -> dict:
    manifest = dict(_bundle_manifest())
    manifest["manifestDigest"] = MANIFEST_DIGEST
    return {
        "bundleVersionId": BUNDLE_VERSION_ID,
        "version": "1.0.0",
        "composition": {
            "roleDocumentId": "role_main",
            "ruleSet": {"rules": []},
            "rootRuntimeSkillId": "role_main",
            "modelProfiles": [
                {
                    "modelProfileId": MODEL_PROFILE_ID,
                    "version": MODEL_PROFILE_VERSION,
                    "modelKey": "doubao-seed-1-6",
                    "capabilities": ["text", "tool_calling"],
                    "maxInputTokens": 100000,
                    "maxOutputTokens": 4096,
                }
            ],
            "toolGrants": [],
            "tokenBudget": {
                "estimator": "chars_div_4",
                "initialContextMaxTokens": 1000,
                "singleResourceMaxTokens": 1000,
                "activeContextMaxTokens": 4000,
            },
            "resourceManifest": manifest,
        },
    }


def _bundle_source() -> FakeBundleSource:
    return FakeBundleSource(
        snapshots={BUNDLE_VERSION_ID: _bundle_snapshot()},
        resources={
            BUNDLE_VERSION_ID: {
                "role_main": {"resource_id": "role_main", "content": ROLE_DOCUMENT_BODY}
            }
        },
    )


# ---- 受限资源读取夹具（IK2QBM：on_demand Skill 正文 + 引用资源）----

SKILL_RESOURCE_ID = "skill_root"
SKILL_NAME = "root_skill"
SKILL_DESC = "根创作工作流"
SKILL_BODY = "# 根创作工作流正文\n1. 澄清意图 2. 提出生图动作。"
REF_RESOURCE_ID = "ref_rule"
REF_BODY = "# 安全规则\n生成前确认比例与风格。"


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _disclosed_skill_resource_id(instructions: str) -> str:
    """从 instructions 解析根 RuntimeSkill 披露的 resourceId（IK306N 按需读取寻址键）。

    未匹配即断言失败——这正是被测的「根 Skill 正文按需读取在生产可达」。
    """
    match = re.search(r"skill resourceId: (\S+)", instructions)
    assert match is not None, "instructions 未披露根 Skill resourceId"
    return match.group(1)


def _skill_manifest() -> dict:
    return {
        "formatVersion": 1,
        "baseUri": f"bw-bundle://{BUNDLE_VERSION_ID}/",
        "digestAlgorithm": "sha256",
        "resources": [
            {
                "resourceId": "role_main",
                "revision": 1,
                "kind": "role_document",
                "path": "AGENTS.md",
                "mediaType": "text/markdown",
                "loadMode": "always_on",
                "contentDigest": _sha256(ROLE_DOCUMENT_BODY),
                "sizeBytes": len(ROLE_DOCUMENT_BODY),
                "tokenEstimate": 32,
                "references": [],
            },
            {
                "resourceId": SKILL_RESOURCE_ID,
                "revision": 1,
                "kind": "runtime_skill",
                "path": "skill.md",
                "mediaType": "text/markdown",
                "loadMode": "on_demand",
                "contentDigest": _sha256(SKILL_BODY),
                "sizeBytes": len(SKILL_BODY),
                "tokenEstimate": 32,
                "references": [{"rawRef": "ref.md", "resolvedResourceId": REF_RESOURCE_ID}],
                "metadata": {
                    "name": SKILL_NAME,
                    "description": SKILL_DESC,
                    "allowImplicitInvocation": False,
                },
            },
            {
                "resourceId": REF_RESOURCE_ID,
                "revision": 1,
                "kind": "rule",
                "path": "ref.md",
                "mediaType": "text/markdown",
                "loadMode": "on_demand",
                "contentDigest": _sha256(REF_BODY),
                "sizeBytes": len(REF_BODY),
                "tokenEstimate": 32,
                "references": [],
            },
        ],
    }


SKILL_MANIFEST_DIGEST = manifest_digest(_skill_manifest())


def _skill_snapshot() -> dict:
    manifest = dict(_skill_manifest())
    manifest["manifestDigest"] = SKILL_MANIFEST_DIGEST
    return {
        "bundleVersionId": BUNDLE_VERSION_ID,
        "version": "1.0.0",
        "composition": {
            "roleDocumentId": "role_main",
            "ruleSet": {"rules": []},
            "rootRuntimeSkillId": SKILL_RESOURCE_ID,
            "modelProfiles": [
                {
                    "modelProfileId": MODEL_PROFILE_ID,
                    "version": MODEL_PROFILE_VERSION,
                    "modelKey": "doubao-seed-1-6",
                    "capabilities": ["text", "tool_calling"],
                    "maxInputTokens": 100000,
                    "maxOutputTokens": 4096,
                }
            ],
            "toolGrants": [],
            "tokenBudget": {
                "estimator": "chars_div_4",
                "initialContextMaxTokens": 1000,
                "singleResourceMaxTokens": 1000,
                "activeContextMaxTokens": 4000,
            },
            "resourceManifest": manifest,
        },
    }


def _skill_source() -> FakeBundleSource:
    return FakeBundleSource(
        snapshots={BUNDLE_VERSION_ID: _skill_snapshot()},
        resources={
            BUNDLE_VERSION_ID: {
                "role_main": {"resource_id": "role_main", "content": ROLE_DOCUMENT_BODY},
                SKILL_RESOURCE_ID: {"resource_id": SKILL_RESOURCE_ID, "content": SKILL_BODY},
                REF_RESOURCE_ID: {"resource_id": REF_RESOURCE_ID, "content": REF_BODY},
            }
        },
    )


def _skill_work(**overrides) -> RunWork:
    fields = dict(
        agent_run_id=23,
        project_id=7,
        conversation_id=11,
        user_id=10,
        run_version=1,
        fencing_token=4,
        engine="pydantic-ai",
        engine_version="2.9.0",
        adapter_schema_version=1,
        messages=({"role": "user", "content": "帮我生成一张海报"},),
        checkpoint=None,
        bundle_version_id=BUNDLE_VERSION_ID,
        manifest_digest=SKILL_MANIFEST_DIGEST,
        model_profile_id=MODEL_PROFILE_ID,
        model_profile_version=MODEL_PROFILE_VERSION,
        tool_grants=(_generate_image_grant(),),
    )
    fields.update(overrides)
    return RunWork(**fields)


def _generate_image_grant() -> ToolGrant:
    return ToolGrant(
        tool_name="generate_image",
        registry_version=1,
        effect="side_effect",
        proposal_only=True,
        argument_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
        },
        constraints={},
    )


def _request_user_input_grant() -> ToolGrant:
    return ToolGrant(
        tool_name="request_user_input",
        registry_version=1,
        effect="side_effect",
        proposal_only=True,
        argument_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
        },
        constraints={},
    )


def _pydantic_work(**overrides) -> RunWork:
    fields = dict(
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
        bundle_version_id=BUNDLE_VERSION_ID,
        manifest_digest=MANIFEST_DIGEST,
        model_profile_id=MODEL_PROFILE_ID,
        model_profile_version=MODEL_PROFILE_VERSION,
        tool_grants=(_generate_image_grant(),),
    )
    fields.update(overrides)
    return RunWork(**fields)


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


def request_user_input_model(messages, info):
    """IK2QBY：意图缺少信息，模型调用显式 request_user_input 工具提出澄清问题。"""
    return ModelResponse(
        parts=(
            ToolCallPart(
                "request_user_input",
                {"request_type": "creation_clarification", "question": "您希望什么风格和比例？"},
                "clarification-call-id",
            ),
        )
    )


def request_user_input_with_binding_model(messages, info):
    """携带 resume_binding 的显式澄清工具调用（AC1 参数映射）。"""
    return ModelResponse(
        parts=(
            ToolCallPart(
                "request_user_input",
                {
                    "request_type": "creation_clarification",
                    "question": "您希望什么风格？",
                    "resume_binding": {"intent": "poster", "round": 1},
                },
                "binding-call-id",
            ),
        )
    )


def clarify_then_image_model(messages, info):
    """首轮调用 request_user_input 提问；恢复后调用 generate_image 出动作。"""
    clarified = any(
        isinstance(message, ModelResponse)
        and any(
            isinstance(part, ToolCallPart) and part.tool_name == "request_user_input"
            for part in message.parts
        )
        for message in messages
    )
    if not clarified:
        return ModelResponse(
            parts=(
                ToolCallPart(
                    "request_user_input",
                    {"request_type": "creation_clarification", "question": "您希望什么风格和比例？"},
                    "clarify-call-id",
                ),
            )
        )
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


def rejected_then_retry_model(messages, info):
    """收到工具结果后调整参数重新提议，模拟模型理解拒绝结果并改提动作。"""
    if any(
        isinstance(part, ToolReturnPart)
        for message in messages
        for part in message.parts
    ):
        return ModelResponse(
            parts=(
                ToolCallPart(
                    "generate_image",
                    {"prompt": "蓝鲸海报", "aspect_ratio": "16:9"},
                    "rejected-retry-call-id",
                ),
            )
        )
    return ModelResponse(
        parts=(
            ToolCallPart(
                "generate_image",
                {"prompt": "蓝鲸海报", "aspect_ratio": "1:1"},
                "rejected-first-call-id",
            ),
        )
    )


class PydanticAIOrchestratorTest(unittest.TestCase):
    def test_bundle_instructions_replace_hardcoded_prompt_and_reach_model(self) -> None:
        # IK2QBJ acceptance #1/#6：instructions 由 Bundle 基础上下文生成，
        # 代码中硬编码角色提示词消失，装载后的 RoleDocument 正文实际进入模型。
        captured = []

        def capturing_model(messages, info):
            captured.append(info.instructions)
            return ModelResponse(parts=(TextPart("您想要什么风格？"),))

        work = _pydantic_work(messages=({"role": "user", "content": "生成一张"},))
        result = PydanticAIOrchestrator(
            FunctionModel(capturing_model), _bundle_source()
        ).advance(work)

        self.assertEqual(1, len(captured))
        instructions = captured[0]
        self.assertIn(ROLE_DOCUMENT_BODY, instructions)
        self.assertNotIn("创作编排器", instructions)  # 硬编码角色提示词已移除
        self.assertNotIn("Blue-Whale", instructions)
        # 纯文本输出直通为可见文本（IK2QBY 后澄清只来自显式 request_user_input 工具）。
        self.assertEqual("您想要什么风格？", result.visible_text)

    def test_first_turn_injects_compact_canvas_materials_context(self) -> None:
        # IK2QC8（契约 §6.1）：首轮（checkpoint None）若 claim 下发 canvas_nodes 非空，
        # 在 prompt 前拼紧凑素材上下文，让素材第一时间进入 Agent 视野。
        captured: list = []

        def capture_prompt_model(messages, info):
            captured.append(messages[-1].parts[-1].content)
            return ModelResponse(parts=(TextPart("好的，了解了画布素材。"),))

        work = _pydantic_work(
            messages=({"role": "user", "content": "参考画布素材生成海报"},),
            canvas_nodes=(
                {"node_id": "node-1", "type": "image", "asset_id": 77},
                {"node_id": "node-2", "type": "image", "asset_id": 88},
            ),
        )
        result = PydanticAIOrchestrator(
            FunctionModel(capture_prompt_model), _bundle_source()
        ).advance(work)

        self.assertIsNone(result.error)
        prompt = captured[0]
        self.assertIn("画布", prompt)
        self.assertIn("type=image", prompt)
        self.assertIn("asset_id=77", prompt)
        self.assertIn("asset_id=88", prompt)
        self.assertIn("参考画布素材生成海报", prompt)

    def test_first_turn_without_canvas_nodes_leaves_prompt_untouched(self) -> None:
        # 默认 canvas_nodes 为空集 → 不注入素材上下文，prompt 原样（既有行为不变）。
        captured: list = []

        def capture_prompt_model(messages, info):
            captured.append(messages[-1].parts[-1].content)
            return ModelResponse(parts=(TextPart("好的"),))

        work = _pydantic_work(messages=({"role": "user", "content": "生成海报"},))
        PydanticAIOrchestrator(
            FunctionModel(capture_prompt_model), _bundle_source()
        ).advance(work)

        self.assertEqual("生成海报", captured[0])

    def test_first_turn_injects_compact_conversation_summary(self) -> None:
        # IK3AH2（契约 §6.1 三段式）：首轮（checkpoint None）若 claim 下发 conversation_summary
        # 非空，在 prompt 前拼紧凑摘要上下文（摘要 + 引用节点 + 最近窗口三段式）。
        captured: list = []

        def capture_prompt_model(messages, info):
            captured.append(messages[-1].parts[-1].content)
            return ModelResponse(parts=(TextPart("好的，了解了历史摘要。"),))

        work = _pydantic_work(
            messages=({"role": "user", "content": "继续之前的对话"},),
            conversation_summary={
                "conversation_id": 11,
                "message_count": 6,
                "first_user_preview": "帮我生成一张海报",
                "last_message_preview": "再调整一下色调",
                "earliest_at": "2026-07-20T10:00:00",
                "latest_at": "2026-07-20T11:00:00",
            },
        )
        result = PydanticAIOrchestrator(
            FunctionModel(capture_prompt_model), _bundle_source()
        ).advance(work)

        self.assertIsNone(result.error)
        prompt = captured[0]
        self.assertIn("摘要", prompt)
        self.assertIn("message_count=6", prompt)
        self.assertIn("first_user_preview=帮我生成一张海报", prompt)
        self.assertIn("last_message_preview=再调整一下色调", prompt)
        self.assertIn("earliest_at=2026-07-20T10:00:00", prompt)
        self.assertIn("latest_at=2026-07-20T11:00:00", prompt)
        self.assertIn("继续之前的对话", prompt)

    def test_first_turn_without_conversation_summary_leaves_prompt_untouched(self) -> None:
        # 默认 conversation_summary 为 None → 不注入摘要，prompt 原样（与 canvas 反例对称）。
        captured: list = []

        def capture_prompt_model(messages, info):
            captured.append(messages[-1].parts[-1].content)
            return ModelResponse(parts=(TextPart("好的"),))

        work = _pydantic_work(messages=({"role": "user", "content": "生成海报"},))
        PydanticAIOrchestrator(
            FunctionModel(capture_prompt_model), _bundle_source()
        ).advance(work)

        self.assertEqual("生成海报", captured[0])

    def test_missing_bundle_pin_fails_closed(self) -> None:
        # pin 缺失（enforcement-enabled=false 形态）不回退硬编码，fail closed。
        work = _pydantic_work(bundle_version_id=None, manifest_digest=None)
        result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), _bundle_source()
        ).advance(work)

        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertEqual((), result.actions)

    def test_bundle_token_budget_exceeded_is_mapped_to_error_code(self) -> None:
        # 初始上下文超预算：规范化 BUNDLE_TOKEN_BUDGET_EXCEEDED 提交 Java，不静默截断。
        tight_snapshot = _bundle_snapshot()
        tight_snapshot["composition"]["tokenBudget"]["initialContextMaxTokens"] = 1
        source = FakeBundleSource(
            snapshots={BUNDLE_VERSION_ID: tight_snapshot},
            resources={
                BUNDLE_VERSION_ID: {
                    "role_main": {"resource_id": "role_main", "content": ROLE_DOCUMENT_BODY}
                }
            },
        )
        result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), source
        ).advance(_pydantic_work())

        self.assertEqual("BUNDLE_TOKEN_BUDGET_EXCEEDED", result.error["code"])
        self.assertEqual((), result.actions)

    def test_model_profile_without_tool_calling_fails_closed(self) -> None:
        no_tools_snapshot = _bundle_snapshot()
        no_tools_snapshot["composition"]["modelProfiles"][0]["capabilities"] = ["text"]
        source = FakeBundleSource(
            snapshots={BUNDLE_VERSION_ID: no_tools_snapshot},
            resources={
                BUNDLE_VERSION_ID: {
                    "role_main": {"resource_id": "role_main", "content": ROLE_DOCUMENT_BODY}
                }
            },
        )
        result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), source
        ).advance(_pydantic_work())

        self.assertEqual("MODEL_CAPABILITY_INSUFFICIENT", result.error["code"])
        self.assertEqual((), result.actions)

    def test_production_adapter_can_propose_owned_reference_asset_ids(self) -> None:
        work = _pydantic_work(messages=({"role": "user", "content": "参考素材生成海报"},))

        result = PydanticAIOrchestrator(
            FunctionModel(reference_image_proposal_model), _bundle_source()
        ).advance(work)

        self.assertEqual(
            [91, 92], result.actions[0].arguments["reference_asset_ids"]
        )

    def test_production_adapter_passes_through_size_and_web_search(self) -> None:
        work = _pydantic_work(
            messages=({"role": "user", "content": "联网生成一张 2K 蓝鲸海报"},)
        )

        result = PydanticAIOrchestrator(
            FunctionModel(size_and_web_search_proposal_model), _bundle_source()
        ).advance(work)
        payload = result.to_commit_payload(work)

        self.assertEqual("2K", payload["actions"][0]["arguments"]["size"])
        self.assertIs(True, payload["actions"][0]["arguments"]["web_search"])

    def test_production_adapter_returns_a_product_neutral_image_proposal(self) -> None:
        work = _pydantic_work()

        result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), _bundle_source()
        ).advance(work)
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
        initial_work = _pydantic_work()
        initial_result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), _bundle_source()
        ).advance(initial_work)
        restored_checkpoint = RuntimeCheckpoint(
            engine=initial_result.checkpoint.engine,
            engine_version=initial_result.checkpoint.engine_version,
            adapter_schema_version=initial_result.checkpoint.adapter_schema_version,
            opaque_payload=json.loads(
                json.dumps(initial_result.checkpoint.opaque_payload, ensure_ascii=False)
            ),
        )
        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            checkpoint=restored_checkpoint,
            accepted_results=(
                AcceptedActionResult(
                    action_id=initial_result.actions[0].action_id,
                    status="succeeded",
                    result={"asset_ids": [91]},
                ),
            ),
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), _bundle_source()
        ).advance(resumed_work)

        self.assertEqual("图片已经生成。", resumed_result.visible_text)
        self.assertEqual((), resumed_result.actions)
        self.assertEqual(
            (), resumed_result.checkpoint.opaque_payload["pending_calls"]
        )

    def test_mismatched_or_corrupt_checkpoint_fails_closed(self) -> None:
        work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            checkpoint=RuntimeCheckpoint(
                engine="pydantic-ai",
                engine_version="2.8.0",
                adapter_schema_version=1,
                opaque_payload={"raw_secret": "checkpoint-private-value"},
            ),
        )

        result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), _bundle_source()
        ).advance(work)
        serialized = json.dumps(result.to_commit_payload(work), ensure_ascii=False)

        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertEqual((), result.actions)
        self.assertNotIn("checkpoint-private-value", serialized)
        self.assertNotIn("2.8.0", serialized)

    def test_framework_exception_is_normalized_without_private_details(self) -> None:
        work = _pydantic_work()

        result = PydanticAIOrchestrator(
            FunctionModel(failing_model), _bundle_source()
        ).advance(work)
        serialized = json.dumps(result.to_commit_payload(work), ensure_ascii=False)

        self.assertEqual("ORCHESTRATION_FAILED", result.error["code"])
        self.assertEqual("编排暂时无法继续。", result.visible_text)
        self.assertEqual((), result.actions)
        self.assertNotIn("sk-test", serialized)
        self.assertNotIn("/tmp/private-prompt", serialized)

    def test_engine_identity_mismatches_are_normalized(self) -> None:
        mismatches = (
            {"engine": "fake"},
            {"engine_version": "2.8.0"},
            {"adapter_schema_version": 2},
        )

        for mismatch in mismatches:
            with self.subTest(mismatch=mismatch):
                work = _pydantic_work(**mismatch)
                result = PydanticAIOrchestrator(
                    FunctionModel(image_proposal_model), _bundle_source()
                ).advance(work)

                self.assertEqual(
                    "ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"]
                )
                self.assertEqual((), result.actions)

    def test_request_user_input_tool_produces_clarification_proposal(self) -> None:
        # IK2QBY：澄清从隐式文本分支升级为显式 request_user_input 副作用工具。
        work = _pydantic_work(
            messages=({"role": "user", "content": "生成一张"},),
            tool_grants=(_generate_image_grant(), _request_user_input_grant()),
        )

        result = PydanticAIOrchestrator(
            FunctionModel(request_user_input_model), _bundle_source()
        ).advance(work)
        payload = result.to_commit_payload(work)

        self.assertEqual((), result.actions)
        self.assertEqual([], payload["actions"])
        self.assertIsNotNone(result.input_request)
        proposal = payload["user_input_request"]
        self.assertEqual("creation_clarification", proposal["request_type"])
        self.assertEqual("您希望什么风格和比例？", proposal["question"])
        self.assertEqual("您希望什么风格和比例？", payload["visible_text"])
        # 澄清工具挂 clarification pending：恢复时把用户回答作为该 deferred call 的
        # ToolResult 回喂。pending 与 ToolCallPart 是 adapter 私有 checkpoint 状态，
        # 与 generate_image 路径一致，不属产品泄露（顶层 input_request 才是产品事实）。
        pending = result.checkpoint.opaque_payload["pending_calls"]
        self.assertEqual(1, len(pending))
        self.assertEqual("clarification", pending[0]["kind"])
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("deferredtoolrequests", serialized.lower())

    def test_request_user_input_maps_resume_binding_argument(self) -> None:
        # IK2QBY AC1：参数映射 UserInputRequestProposal（request_type / question / resume_binding）。
        work = _pydantic_work(
            tool_grants=(_generate_image_grant(), _request_user_input_grant()),
        )
        result = PydanticAIOrchestrator(
            FunctionModel(request_user_input_with_binding_model), _bundle_source()
        ).advance(work)
        proposal = result.to_commit_payload(work)["user_input_request"]

        self.assertEqual("creation_clarification", proposal["request_type"])
        self.assertEqual("您希望什么风格？", proposal["question"])
        self.assertEqual({"intent": "poster", "round": 1}, proposal["resume_binding"])

    def test_clarification_resume_proposes_a_single_image_action(self) -> None:
        grants = (_generate_image_grant(), _request_user_input_grant())
        initial_work = _pydantic_work(tool_grants=grants)
        initial_result = PydanticAIOrchestrator(
            FunctionModel(clarify_then_image_model), _bundle_source()
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
        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            messages=(
                {"role": "user", "content": "生成一张蓝鲸海报"},
                {"role": "assistant", "content": "您希望什么风格和比例？"},
                {"role": "user", "content": "水墨风格带留白"},
            ),
            checkpoint=restored_checkpoint,
            tool_grants=grants,
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(clarify_then_image_model), _bundle_source()
        ).advance(resumed_work)

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

    def test_rejected_clarification_is_fed_back_to_model(self) -> None:
        # IK3AH2：服务端 grant 未授予的澄清被软回喂为 rejected，Worker 把拒绝结果回喂该
        # tool_call_id（不取用户回答），让模型改走动作路径。
        grants = (_generate_image_grant(), _request_user_input_grant())
        initial_work = _pydantic_work(tool_grants=grants)
        initial_result = PydanticAIOrchestrator(
            FunctionModel(clarify_then_image_model), _bundle_source()
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
        rejected = AcceptedActionResult(
            action_id="clarification:" + str(initial_work.agent_run_id),
            status="rejected",
            result={
                "public_code": "ACTION_NOT_ALLOWED",
                "message": "当前动作未获授权。",
                "retryable": False,
            },
        )
        captured: list = []

        def capture_deferred_result_model(messages, info):
            captured.extend(
                part for message in messages
                for part in message.parts
                if isinstance(part, ToolReturnPart)
            )
            return ModelResponse(parts=(ToolCallPart(
                "generate_image",
                {"prompt": "蓝鲸海报", "aspect_ratio": "1:1"},
                "retry-call-id",
            ),))

        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            messages=(
                {"role": "user", "content": "生成一张蓝鲸海报"},
                {"role": "assistant", "content": "您希望什么风格和比例？"},
                {"role": "user", "content": "水墨风格带留白"},
            ),
            checkpoint=restored_checkpoint,
            accepted_results=(rejected,),
            tool_grants=grants,
        )
        result = PydanticAIOrchestrator(
            FunctionModel(capture_deferred_result_model), _bundle_source()
        ).advance(resumed_work)

        # 澄清 tool_call_id 收到 rejected 回喂（status=rejected + 拒绝公开码），不取用户回答。
        self.assertIsNone(result.error)
        rejected_payloads = [
            str(part.content) for part in captured if "rejected" in str(part.content)
        ]
        self.assertTrue(rejected_payloads)
        self.assertIn("ACTION_NOT_ALLOWED", rejected_payloads[0])

    def test_clarification_resume_can_propose_another_clarification(self) -> None:
        # IK2QBY AC3：解除「澄清恢复后必须出动作」自限，支持两次以上澄清往返。
        grants = (_generate_image_grant(), _request_user_input_grant())
        initial_work = _pydantic_work(tool_grants=grants)
        initial_result = PydanticAIOrchestrator(
            FunctionModel(request_user_input_model), _bundle_source()
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
        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            messages=(
                {"role": "user", "content": "生成一张蓝鲸海报"},
                {"role": "assistant", "content": "您希望什么风格和比例？"},
                {"role": "user", "content": "水墨风格"},
            ),
            checkpoint=restored_checkpoint,
            tool_grants=grants,
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(request_user_input_model), _bundle_source()
        ).advance(resumed_work)

        # 第二轮澄清：再次提出输入请求，不出动作，不 fail closed。
        self.assertIsNone(resumed_result.error)
        self.assertEqual((), resumed_result.actions)
        self.assertIsNotNone(resumed_result.input_request)
        self.assertEqual(
            "您希望什么风格和比例？", resumed_result.input_request.question
        )
        # 第二轮澄清同样挂 clarification pending，等待下一个回答闭合。
        resumed_pending = resumed_result.checkpoint.opaque_payload["pending_calls"]
        self.assertEqual(1, len(resumed_pending))
        self.assertEqual("clarification", resumed_pending[0]["kind"])

    def test_clarification_resume_plain_text_passes_through(self) -> None:
        # IK2QBY：澄清恢复后的纯文本输出（无工具调用）作为自然对话回应直通，
        # 不再 fail closed（「澄清恢复后必须出动作」自限已解除）。
        grants = (_generate_image_grant(), _request_user_input_grant())
        initial_work = _pydantic_work(tool_grants=grants)
        initial_result = PydanticAIOrchestrator(
            FunctionModel(request_user_input_model), _bundle_source()
        ).advance(initial_work)
        self.assertIsNotNone(initial_result.input_request)
        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            messages=(
                {"role": "user", "content": "生成一张蓝鲸海报"},
                {"role": "assistant", "content": "您希望什么风格和比例？"},
                {"role": "user", "content": "水墨风格"},
            ),
            checkpoint=initial_result.checkpoint,
            tool_grants=grants,
        )

        result = PydanticAIOrchestrator(
            FunctionModel(always_text_model), _bundle_source()
        ).advance(resumed_work)

        self.assertIsNone(result.error)
        self.assertEqual((), result.actions)
        self.assertIsNone(result.input_request)
        self.assertEqual("仍然缺少信息。", result.visible_text)

    def test_resumed_model_text_is_replaced_by_fixed_product_copy(self) -> None:
        initial_work = _pydantic_work()
        initial_result = PydanticAIOrchestrator(
            FunctionModel(unsafe_resume_model), _bundle_source()
        ).advance(initial_work)
        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            checkpoint=initial_result.checkpoint,
            accepted_results=(
                AcceptedActionResult(
                    action_id=initial_result.actions[0].action_id,
                    status="succeeded",
                    result={"asset_ids": [91]},
                ),
            ),
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(unsafe_resume_model), _bundle_source()
        ).advance(resumed_work)

        self.assertEqual("图片已经生成。", resumed_result.visible_text)
        self.assertNotIn("sk-private", resumed_result.visible_text)

    def test_tool_set_built_from_grant_and_unauthorized_invisible(self) -> None:
        # 模型可见工具集由当次 Run 钉住的 ToolGrant 决定；未授权工具不出现在工具列表。
        captured: dict = {}

        def image_capture_model(messages, info):
            captured["with_grant"] = sorted(t.name for t in info.function_tools)
            return ModelResponse(
                parts=(
                    ToolCallPart(
                        "generate_image",
                        {"prompt": "蓝鲸", "aspect_ratio": "1:1"},
                        "capture-call-id",
                    ),
                )
            )

        def text_capture_model(messages, info):
            captured["without_grant"] = sorted(t.name for t in info.function_tools)
            return ModelResponse(parts=(TextPart("纯文本对话"),))

        result = PydanticAIOrchestrator(
            FunctionModel(image_capture_model), _bundle_source()
        ).advance(_pydantic_work(messages=({"role": "user", "content": "你好"},)))
        self.assertIn("generate_image", captured["with_grant"])
        self.assertEqual("create_image_generation_job", result.actions[0].tool_id)

        # grant 为空集：未授权业务工具不可见；read_resource 是 Bundle 固有受限读取
        # 工具，不经 ToolGrant，每个有 Bundle pin 的 Run 总注入（IK2QBM）。
        text_result = PydanticAIOrchestrator(
            FunctionModel(text_capture_model), _bundle_source()
        ).advance(
            _pydantic_work(messages=({"role": "user", "content": "你好"},), tool_grants=())
        )
        self.assertEqual(["read_resource"], captured["without_grant"])
        self.assertIsNone(text_result.error)

    def test_read_only_direct_and_side_effect_deferred_registration(self) -> None:
        # 只读 effect 以直接工具注册（handler 直接执行返回）；副作用 effect 以 deferred 注册（raise CallDeferred）。
        read_calls: list = []

        def fake_read(resource_id: str) -> str:
            """直接工具：读取并返回结果，模型可见其返回。"""
            read_calls.append(resource_id)
            return "read-content"

        def fake_side_effect(payload: str) -> str:
            """副作用工具：仅提议，由控制面接纳。"""
            raise CallDeferred

        schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}
        implementations = {
            "fake_read": ToolImplementation("fake_read", "fake_read_tool", 1, "read", fake_read),
            "fake_side_effect": ToolImplementation(
                "fake_side_effect", "fake_side_effect_tool", 1, "side_effect", fake_side_effect
            ),
        }
        grants = (
            ToolGrant("fake_read", 1, "read", True, dict(schema), {}),
            ToolGrant("fake_side_effect", 1, "side_effect", True, dict(schema), {}),
        )

        def read_then_text_model(messages, info):
            if not any(
                isinstance(part, ToolReturnPart)
                for message in messages
                for part in message.parts
            ):
                return ModelResponse(
                    parts=(ToolCallPart("fake_read", {"resource_id": "node-1"}, "read-call-id"),)
                )
            return ModelResponse(parts=(TextPart("读取完成"),))

        read_result = PydanticAIOrchestrator(
            FunctionModel(read_then_text_model), _bundle_source(), implementations
        ).advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读一下"},), tool_grants=grants
            )
        )
        self.assertEqual(["node-1"], read_calls)
        self.assertIsNone(read_result.error)

        def side_effect_model(messages, info):
            return ModelResponse(
                parts=(ToolCallPart("fake_side_effect", {"payload": "x"}, "se-call-id"),)
            )

        side_result = PydanticAIOrchestrator(
            FunctionModel(side_effect_model), _bundle_source(), implementations
        ).advance(
            _pydantic_work(
                messages=({"role": "user", "content": "读一下"},), tool_grants=grants
            )
        )
        self.assertEqual(1, len(side_result.actions))
        self.assertEqual("fake_side_effect_tool", side_result.actions[0].tool_id)

    def test_contract_violations_fail_closed_without_internal_leaks(self) -> None:
        # grant 不匹配 / 工具不在注册表 / 版本漂移 / effect 不符 一律 fail closed，
        # 并入现有归一化通道（ORCHESTRATOR_CONTRACT_MISMATCH），不泄露内部工具名或路径。
        schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}

        def plain_text_model(messages, info):
            return ModelResponse(parts=(TextPart("文本"),))

        unknown = (ToolGrant("ghost_tool", 1, "read", True, dict(schema), {}),)
        work = _pydantic_work(
            messages=({"role": "user", "content": "你好"},), tool_grants=unknown
        )
        result = PydanticAIOrchestrator(
            FunctionModel(plain_text_model), _bundle_source()
        ).advance(work)
        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertNotIn(
            "ghost_tool",
            json.dumps(result.to_commit_payload(work), ensure_ascii=False),
        )

        drifted = (ToolGrant("generate_image", 99, "side_effect", True, dict(schema), {}),)
        work = _pydantic_work(
            messages=({"role": "user", "content": "你好"},), tool_grants=drifted
        )
        result = PydanticAIOrchestrator(
            FunctionModel(plain_text_model), _bundle_source()
        ).advance(work)
        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertNotIn(
            "generate_image",
            json.dumps(result.to_commit_payload(work), ensure_ascii=False),
        )

        mismatched = (ToolGrant("generate_image", 1, "read", True, dict(schema), {}),)
        work = _pydantic_work(
            messages=({"role": "user", "content": "你好"},), tool_grants=mismatched
        )
        result = PydanticAIOrchestrator(
            FunctionModel(plain_text_model), _bundle_source()
        ).advance(work)
        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
        self.assertNotIn(
            "generate_image",
            json.dumps(result.to_commit_payload(work), ensure_ascii=False),
        )

    def test_gateway_malformed_tool_grants_normalizes_via_orchestrator(self) -> None:
        # Java 下发畸形 toolGrants（关键字段缺失）：gateway 不抛未归一化异常，
        # 字段缺失落入默认值，由 orchestrator 语义校验统一归一化为 ORCHESTRATOR_CONTRACT_MISMATCH。
        from blue_whale_agent_worker.http_gateway import _parse_tool_grants

        grants = _parse_tool_grants(
            '[{"registryVersion": 1, "effect": "read", "proposalOnly": true, '
            '"argumentSchema": {"$schema": "x"}, "constraints": {}}]'
        )
        self.assertEqual("", grants[0].tool_name)

        def plain_text_model(messages, info):
            return ModelResponse(parts=(TextPart("文本"),))

        result = PydanticAIOrchestrator(
            FunctionModel(plain_text_model), _bundle_source()
        ).advance(
            _pydantic_work(
                messages=({"role": "user", "content": "你好"},), tool_grants=grants
            )
        )
        self.assertEqual("ORCHESTRATOR_CONTRACT_MISMATCH", result.error["code"])
    def test_rejected_action_surfaces_user_safe_message_without_internal_codes(self) -> None:
        # IK2QBX 动作被治理拒绝后，拒绝结果经已接纳通道回喂；模型不再提动作时，
        # 编排用面向 User 的安全提示收尾，不暴露内部 reasonCode，也不报编排失败。
        initial_result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), _bundle_source()
        ).advance(_pydantic_work())
        restored_checkpoint = RuntimeCheckpoint(
            engine=initial_result.checkpoint.engine,
            engine_version=initial_result.checkpoint.engine_version,
            adapter_schema_version=initial_result.checkpoint.adapter_schema_version,
            opaque_payload=json.loads(
                json.dumps(initial_result.checkpoint.opaque_payload, ensure_ascii=False)
            ),
        )
        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            checkpoint=restored_checkpoint,
            accepted_results=(
                AcceptedActionResult(
                    action_id=initial_result.actions[0].action_id,
                    status="rejected",
                    result={
                        "public_code": "QUOTA_EXCEEDED",
                        "message": "当前操作超过可用额度。",
                        "retryable": True,
                    },
                ),
            ),
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(image_proposal_model), _bundle_source()
        ).advance(resumed_work)
        payload = resumed_result.to_commit_payload(resumed_work)

        self.assertEqual("当前操作超过可用额度。", resumed_result.visible_text)
        self.assertEqual((), resumed_result.actions)
        self.assertEqual([], payload["actions"])
        self.assertIsNone(resumed_result.error)
        serialized = json.dumps(payload, ensure_ascii=False)
        # 内部诊断码不外泄；QUOTA_EXCEEDED 是面向 User 的稳定公开码，可暴露。
        self.assertNotIn("ACTION_SCHEMA_OR_OWNERSHIP_REJECTED", serialized)

    def test_rejected_action_lets_model_adjust_and_repropose(self) -> None:
        # IK2QBX 拒绝结果回喂后，模型可调整参数改提新动作；编排照常接纳新提议。
        initial_result = PydanticAIOrchestrator(
            FunctionModel(rejected_then_retry_model), _bundle_source()
        ).advance(_pydantic_work())
        restored_checkpoint = RuntimeCheckpoint(
            engine=initial_result.checkpoint.engine,
            engine_version=initial_result.checkpoint.engine_version,
            adapter_schema_version=initial_result.checkpoint.adapter_schema_version,
            opaque_payload=json.loads(
                json.dumps(initial_result.checkpoint.opaque_payload, ensure_ascii=False)
            ),
        )
        resumed_work = _pydantic_work(
            run_version=2,
            fencing_token=5,
            checkpoint=restored_checkpoint,
            accepted_results=(
                AcceptedActionResult(
                    action_id=initial_result.actions[0].action_id,
                    status="rejected",
                    result={
                        "public_code": "ACTION_NOT_ALLOWED",
                        "message": "当前动作未获授权。",
                        "retryable": False,
                    },
                ),
            ),
        )

        resumed_result = PydanticAIOrchestrator(
            FunctionModel(rejected_then_retry_model), _bundle_source()
        ).advance(resumed_work)
        payload = resumed_result.to_commit_payload(resumed_work)

        self.assertEqual(1, len(resumed_result.actions))
        self.assertEqual("create_image_generation_job", payload["actions"][0]["tool_id"])
        self.assertEqual("16:9", payload["actions"][0]["arguments"]["aspect_ratio"])
        self.assertEqual("已接纳，正在生成图片。", resumed_result.visible_text)

    def test_untriggered_skill_body_stays_out_of_model_context(self) -> None:
        # IK2QBM acceptance #2：未触发 Skill 正文不进入模型上下文；instructions 仅含元数据。
        captured: list = []

        def capture_model(messages, info):
            captured.append(info.instructions)
            return ModelResponse(parts=(TextPart("您想要什么风格？"),))

        result = PydanticAIOrchestrator(
            FunctionModel(capture_model), _skill_source()
        ).advance(_skill_work())

        self.assertEqual(1, len(captured))
        self.assertNotIn(SKILL_BODY, captured[0])
        self.assertNotIn(REF_BODY, captured[0])
        self.assertIn(SKILL_NAME, captured[0])  # 元数据仍披露
        self.assertIn("skill resourceId", captured[0])  # 根 id 元数据级披露（IK306N）
        # 未触发 on_demand 读取：evidence 只含 initial
        origins = {entry["origin"] for entry in result.bundle_evidence}
        self.assertEqual({"initial"}, origins)

    def test_triggered_skill_body_enters_via_read_resource(self) -> None:
        # IK2QBM acceptance #2/#6 + IK306N：模型从 instructions 披露的根 Skill resourceId 出发
        # 触发 read_resource 读 Skill 正文，经工具返回进入，产生 on_demand 证据并随 commit 回传。
        captured_instructions: list = []

        def read_then_clarify_model(messages, info):
            captured_instructions.append(info.instructions)
            if not any(
                isinstance(part, ToolReturnPart)
                for message in messages
                for part in message.parts
            ):
                # 生产语义：根 id 来自 instructions 披露，不硬编码（IK306N）
                skill_id = _disclosed_skill_resource_id(info.instructions)
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_resource",
                            {"resource_id": skill_id},
                            "read-skill-call",
                        ),
                    )
                )
            return ModelResponse(parts=(TextPart("已读取工作流，请补充风格。"),))

        result = PydanticAIOrchestrator(
            FunctionModel(read_then_clarify_model), _skill_source()
        ).advance(_skill_work())

        disclosed_skill_id = _disclosed_skill_resource_id(captured_instructions[0])
        on_demand = [
            entry for entry in result.bundle_evidence if entry["origin"] == "on_demand"
        ]
        self.assertEqual(1, len(on_demand))
        self.assertEqual(disclosed_skill_id, on_demand[0]["resource_id"])
        self.assertEqual(_sha256(SKILL_BODY), on_demand[0]["content_digest"])
        payload = result.to_commit_payload(_skill_work())
        self.assertIsNotNone(payload["bundle_evidence"])
        read_ids = {entry["resource_id"] for entry in payload["bundle_evidence"]}
        self.assertIn(disclosed_skill_id, read_ids)

    def test_triggered_skill_references_read_in_layers(self) -> None:
        # IK2QBM acceptance #2：触发后正文与引用资源可逐层按需读取。instructions 披露
        # Skill 已解析引用的 resourceId，模型先读 Skill 正文，再据披露的引用键读引用 Rule。
        captured: list = []

        def read_in_layers_model(messages, info):
            captured.append(info.instructions)
            returns = [
                part
                for message in messages
                for part in message.parts
                if isinstance(part, ToolReturnPart)
            ]
            if len(returns) == 0:
                # 生产语义：根 id 来自 instructions 披露（IK306N）
                skill_id = _disclosed_skill_resource_id(info.instructions)
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_resource",
                            {"resource_id": skill_id},
                            "read-skill",
                        ),
                    )
                )
            if len(returns) == 1:
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_resource",
                            {"resource_id": REF_RESOURCE_ID},
                            "read-ref",
                        ),
                    )
                )
            return ModelResponse(parts=(TextPart("已读工作流与安全规则，请补充比例。"),))

        result = PydanticAIOrchestrator(
            FunctionModel(read_in_layers_model), _skill_source()
        ).advance(_skill_work())

        # instructions 披露引用 resourceId：模型逐层寻址键可达
        self.assertIn(REF_RESOURCE_ID, captured[0])
        # 两层 on_demand 读取证据随 commit 回传
        on_demand_ids = {
            entry["resource_id"]
            for entry in result.bundle_evidence
            if entry["origin"] == "on_demand"
        }
        self.assertEqual({SKILL_RESOURCE_ID, REF_RESOURCE_ID}, on_demand_ids)
        self.assertEqual(
            _sha256(REF_BODY),
            next(
                entry["content_digest"]
                for entry in result.bundle_evidence
                if entry["resource_id"] == REF_RESOURCE_ID
            ),
        )

    def test_read_resource_digest_mismatch_fails_closed_end_to_end(self) -> None:
        # IK2QBM acceptance #3：源端正文与 manifest 摘要不符 → BUNDLE_RESOURCE_DIGEST_MISMATCH。
        tampered = FakeBundleSource(
            snapshots={BUNDLE_VERSION_ID: _skill_snapshot()},
            resources={
                BUNDLE_VERSION_ID: {
                    "role_main": {"resource_id": "role_main", "content": ROLE_DOCUMENT_BODY},
                    SKILL_RESOURCE_ID: {
                        "resource_id": SKILL_RESOURCE_ID,
                        "content": "被篡改的工作流正文",
                    },
                    REF_RESOURCE_ID: {"resource_id": REF_RESOURCE_ID, "content": REF_BODY},
                }
            },
        )

        def read_model(messages, info):
            skill_id = _disclosed_skill_resource_id(info.instructions)
            return ModelResponse(
                parts=(
                    ToolCallPart(
                        "read_resource",
                        {"resource_id": skill_id},
                        "tampered-call",
                    ),
                )
            )

        result = PydanticAIOrchestrator(FunctionModel(read_model), tampered).advance(
            _skill_work()
        )
        self.assertEqual("BUNDLE_RESOURCE_DIGEST_MISMATCH", result.error["code"])

    def test_checkpoint_replay_rebuilds_read_resource_ledger(self) -> None:
        # IK2QBM acceptance #7：checkpoint 恢复从消息历史确定性重建 read_resource 已读集合。
        def read_then_image_model(messages, info):
            has_return = any(
                isinstance(part, ToolReturnPart)
                for message in messages
                for part in message.parts
            )
            if not has_return:
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_resource",
                            {"resource_id": REF_RESOURCE_ID},
                            "read-ref-call",
                        ),
                    )
                )
            return ModelResponse(
                parts=(
                    ToolCallPart(
                        "generate_image",
                        {"prompt": "海报", "aspect_ratio": "1:1"},
                        "img-call",
                    ),
                )
            )

        def resume_text_model(messages, info):
            return ModelResponse(parts=(TextPart("图片已经生成。"),))

        initial = PydanticAIOrchestrator(
            FunctionModel(read_then_image_model), _skill_source()
        ).advance(_skill_work())
        self.assertEqual(1, len(initial.actions))  # 首轮 read_resource 后提议生图
        first_on_demand = [
            entry for entry in initial.bundle_evidence if entry["origin"] == "on_demand"
        ]
        self.assertEqual(1, len(first_on_demand))
        self.assertEqual(REF_RESOURCE_ID, first_on_demand[0]["resource_id"])

        restored = RuntimeCheckpoint(
            engine=initial.checkpoint.engine,
            engine_version=initial.checkpoint.engine_version,
            adapter_schema_version=initial.checkpoint.adapter_schema_version,
            opaque_payload=json.loads(
                json.dumps(initial.checkpoint.opaque_payload, ensure_ascii=False)
            ),
        )
        resumed = PydanticAIOrchestrator(
            FunctionModel(resume_text_model), _skill_source()
        ).advance(
            _skill_work(
                run_version=2,
                fencing_token=5,
                checkpoint=restored,
                accepted_results=(
                    AcceptedActionResult(
                        action_id=initial.actions[0].action_id,
                        status="succeeded",
                        result={"asset_ids": [91]},
                    ),
                ),
            )
        )
        history = [
            entry for entry in resumed.bundle_evidence if entry["origin"] == "history"
        ]
        self.assertEqual(1, len(history))
        self.assertEqual(REF_RESOURCE_ID, history[0]["resource_id"])
        # 恢复重建后不再 on_demand 重复读 ref
        resumed_on_demand = [
            entry for entry in resumed.bundle_evidence if entry["origin"] == "on_demand"
        ]
        self.assertEqual(0, len(resumed_on_demand))

    def test_checkpoint_opaque_payload_excludes_read_ledger(self) -> None:
        # IK2QBQ acceptance #3：已读账本不进 checkpoint opaque payload（契约 §6：
        # checkpoint 保持不透明、不嵌 Bundle 内容）。恢复时从消息历史重建账本，
        # 而非从 checkpoint 复制——故 checkpoint 不得残留账本、证据或资源正文。
        def read_then_image_model(messages, info):
            has_return = any(
                isinstance(part, ToolReturnPart)
                for message in messages
                for part in message.parts
            )
            if not has_return:
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_resource",
                            {"resource_id": REF_RESOURCE_ID},
                            "read-ref-call",
                        ),
                    )
                )
            return ModelResponse(
                parts=(
                    ToolCallPart(
                        "generate_image",
                        {"prompt": "海报", "aspect_ratio": "1:1"},
                        "img-call",
                    ),
                )
            )

        result = PydanticAIOrchestrator(
            FunctionModel(read_then_image_model), _skill_source()
        ).advance(_skill_work())
        # 触发过 on_demand 读取：证据随 commit 回传，但不入 checkpoint
        self.assertTrue(
            any(entry["origin"] == "on_demand" for entry in result.bundle_evidence)
        )
        payload = result.checkpoint.opaque_payload
        # checkpoint 只保存框架不透明状态：format / messages / pending_calls
        self.assertEqual({"format", "messages", "pending_calls"}, set(payload.keys()))
        # 账本、证据标记或资源正文绝不嵌入 checkpoint
        serialized = json.dumps(payload, ensure_ascii=False)
        for forbidden in ("ledger", "evidence", "charged", SKILL_BODY, REF_BODY):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
