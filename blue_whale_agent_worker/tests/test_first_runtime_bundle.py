"""首版 Runtime Bundle（IK2D8R）行为评测与隔离装载测试。

被测对象由 ``blue-whale-agent-workspace/runtime-bundle/build.py`` 从维护源现场组装
（``dist/`` 便携包是本地生成物，不入库）——源即夹具：经 ``FakeBundleSource`` 全离线
装载（零网络、零 Java 依赖，即契约意义上的隔离运行环境），验证工单验收的行为场景
与 fail closed 矩阵：

- 恰好一个 RoleDocument + 一个根 RuntimeSkill；初始上下文只含 Role、always_on Rules
  与 Skill 元数据；Creative Skill 正文与历史创作模板不进基础上下文。
- 资源正文不含已废弃语义词汇（固定语义路由字段 / 分类器 / 固定分支枚举 / 旧公开端点）。
- 行为样例：纯咨询零动作、连续多轮澄清、明确请求直接提议图片/视频动作、未激活 Skill
  正文不加载、弱继续不被误当高成本授权、旧固定分支词汇不影响运行。
  行为样例使用脚本化 FunctionModel：验证编排管道不阻断目标行为、且对应 Rule 真实注入
  初始上下文，不构成对提示词引导真实模型行为的评测（真实模型评测属工单范围外）。
- fail closed：Bundle 缺失、manifest 摘要不符、资源越界、预算超限。

夹具形态（FunctionModel + checkpoint 轮换）镜像 test_pydantic_orchestrator.py。
"""

from __future__ import annotations

import copy
import importlib.util
import json
import unittest
from pathlib import Path

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart

from blue_whale_agent_worker.bundle.loader import ContextLoader
from blue_whale_agent_worker.bundle.source import FakeBundleSource
from blue_whale_agent_worker.bundle.verifier import BundleVerifier
from blue_whale_agent_worker.contracts import RunWork, RuntimeCheckpoint, ToolGrant
from blue_whale_agent_worker.pydantic_orchestrator import PydanticAIOrchestrator

from test_pydantic_orchestrator import _advance, streaming_model

REPO_ROOT = Path(__file__).resolve().parents[2]
BUNDLE_DIR = REPO_ROOT / "blue-whale-agent-workspace" / "runtime-bundle"


def _load_build_module():
    """按路径加载 runtime-bundle/build.py（stdlib-only），现场组装便携包。"""
    spec = importlib.util.spec_from_file_location(
        "first_bundle_build", BUNDLE_DIR / "build.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = _load_build_module()
PACKAGE = BUILD.build_package()
COMPOSITION = PACKAGE["composition"]
MANIFEST = COMPOSITION["resourceManifest"]
BUNDLE_VERSION_ID = PACKAGE["bundle_version_id"]
MANIFEST_DIGEST = MANIFEST["manifestDigest"]
MODEL_PROFILE_ID = COMPOSITION["modelProfiles"][0]["modelProfileId"]
MODEL_PROFILE_VERSION = COMPOSITION["modelProfiles"][0]["version"]
MODEL_KEY = COMPOSITION["modelProfiles"][0]["modelKey"]

# 已废弃语义词汇：不得以任何形式复活于首版 Bundle 资源正文。
RETIRED_VOCABULARY = (
    "decision_context",
    "intent_direction",
    "suggested_route",
    "decision_branch",
    "/agent/turn",
    "九分支",
    "一次澄清后必须生图",
)


def _snapshot(**composition_overrides) -> dict:
    composition = copy.deepcopy(COMPOSITION)
    composition.update(composition_overrides)
    return {
        "bundleVersionId": BUNDLE_VERSION_ID,
        "version": PACKAGE["version"],
        "composition": composition,
    }


def _resources(**content_overrides) -> dict:
    return {
        entry["resource_id"]: {
            "resource_id": entry["resource_id"],
            "content": content_overrides.get(entry["resource_id"], entry["content"]),
        }
        for entry in PACKAGE["resources"]
    }


def _source(**content_overrides) -> FakeBundleSource:
    return FakeBundleSource(
        snapshots={BUNDLE_VERSION_ID: _snapshot()},
        resources={BUNDLE_VERSION_ID: _resources(**content_overrides)},
    )


def _grant(tool_name: str) -> ToolGrant:
    """以首版 Bundle 固化的 ToolGrant（schema/约束与 Java 注册表对齐）构造 Run pin 授权。"""
    grant = next(
        entry for entry in COMPOSITION["toolGrants"] if entry["toolName"] == tool_name
    )
    return ToolGrant(
        tool_name=grant["toolName"],
        registry_version=grant["registryVersion"],
        effect=grant["effect"],
        proposal_only=grant["proposalOnly"],
        argument_schema=grant["argumentSchema"],
        constraints=grant["constraints"],
    )


def _work(**overrides) -> RunWork:
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
        messages=({"role": "user", "content": "帮我做一张海报"},),
        checkpoint=None,
        bundle_version_id=BUNDLE_VERSION_ID,
        manifest_digest=MANIFEST_DIGEST,
        model_profile_id=MODEL_PROFILE_ID,
        model_profile_version=MODEL_PROFILE_VERSION,
        tool_grants=(),
    )
    fields.update(overrides)
    return RunWork(**fields)


def _restored(checkpoint: RuntimeCheckpoint) -> RuntimeCheckpoint:
    return RuntimeCheckpoint(
        engine=checkpoint.engine,
        engine_version=checkpoint.engine_version,
        adapter_schema_version=checkpoint.adapter_schema_version,
        opaque_payload=json.loads(
            json.dumps(checkpoint.opaque_payload, ensure_ascii=False)
        ),
    )


class PackageBuildTest(unittest.TestCase):
    """构建一致性与静态形状（验收：便携包可静态校验、形状最小）。"""

    def test_build_is_deterministic(self) -> None:
        # 同一维护源重复构建产出逐字节一致的便携包（可复现，契约 §8.1 逻辑往返前提）。
        self.assertEqual(
            BUILD.render_package(PACKAGE), BUILD.render_package(BUILD.build_package())
        )

    def test_exactly_one_role_document_and_one_root_runtime_skill(self) -> None:
        kinds = [entry["kind"] for entry in MANIFEST["resources"]]
        self.assertEqual(1, kinds.count("role_document"))
        self.assertEqual(1, kinds.count("runtime_skill"))
        role = next(e for e in MANIFEST["resources"] if e["kind"] == "role_document")
        skill = next(e for e in MANIFEST["resources"] if e["kind"] == "runtime_skill")
        self.assertEqual(role["resourceId"], COMPOSITION["roleDocumentId"])
        self.assertEqual(skill["resourceId"], COMPOSITION["rootRuntimeSkillId"])
        self.assertEqual("always_on", role["loadMode"])
        self.assertEqual("on_demand", skill["loadMode"])
        # RuleSet 显式列出全部 Rule，顺序稳定。
        rule_ids = [e["resourceId"] for e in MANIFEST["resources"] if e["kind"] == "rule"]
        self.assertEqual(sorted(rule_ids), sorted(COMPOSITION["ruleSet"]["rules"]))

    def test_no_creative_skill_or_historical_templates_in_bundle(self) -> None:
        # library/raw 创作模板归属 Creative Skill 库（迁移清单），不进 Runtime Bundle。
        for entry in MANIFEST["resources"]:
            self.assertNotEqual("creative_skill", entry["kind"])
            self.assertFalse(entry["path"].startswith("library/"))

    def test_resource_bodies_free_of_retired_vocabulary(self) -> None:
        for entry in PACKAGE["resources"]:
            content = entry["content"]
            for term in RETIRED_VOCABULARY:
                with self.subTest(resource=entry["resource_id"], term=term):
                    self.assertNotIn(term, content)
            self.assertNotRegex(content, r"\bL1\b")
            self.assertNotRegex(content, r"\bL2\b")


class InitialContextTest(unittest.TestCase):
    """初始上下文边界（验收：只含 Role + always_on Rules + Skill 元数据）。"""

    @staticmethod
    def _load() -> tuple:
        source = _source()
        verified = BundleVerifier(source).verify(BUNDLE_VERSION_ID, MANIFEST_DIGEST)
        loaded = ContextLoader(source).load(verified, MODEL_PROFILE_ID, MODEL_PROFILE_VERSION)
        return source, verified, loaded

    def test_initial_context_contents(self) -> None:
        _, _, loaded = self._load()
        instructions = loaded.instructions
        bodies = {entry["resource_id"]: entry["content"] for entry in PACKAGE["resources"]}
        # Role 与 4 条 always_on Rule 正文进入。
        self.assertIn(bodies["role_director"], instructions)
        for rule_id in COMPOSITION["ruleSet"]["rules"]:
            self.assertIn(bodies[rule_id], instructions)
        # Skill 元数据（name/description）与按需读取寻址键进入。
        skill = next(e for e in PACKAGE["resources"] if e["kind"] == "runtime_skill")
        self.assertIn(skill["metadata"]["name"], instructions)
        self.assertIn("skill resourceId: skill_director_workflow", instructions)
        self.assertIn("reference resourceId: ref_generation_action_guide", instructions)
        # 根 Skill 正文与引用资源正文不进入。
        self.assertNotIn(bodies["skill_director_workflow"], instructions)
        self.assertNotIn(bodies["ref_generation_action_guide"], instructions)

    def test_model_key_matches_pinned_profile(self) -> None:
        _, _, loaded = self._load()
        self.assertEqual(MODEL_KEY, loaded.model_key)


class BehaviorScenarioTest(unittest.TestCase):
    """行为评测样例（验收：顾问式多轮、不依赖固定分支）。"""

    def test_pure_consultation_yields_zero_actions(self) -> None:
        # 纯咨询：只回答，不创建 GenerationJob、不提出任何动作。
        def consult_model(messages, info):
            return ModelResponse(parts=(TextPart("这是顾问式回答，不需要生成。"),))

        result = _advance(
            PydanticAIOrchestrator(streaming_model(consult_model), _source()),
            _work(messages=({"role": "user", "content": "产品视频一般怎么做？"},)),
        )
        self.assertIsNone(result.error)
        self.assertEqual((), tuple(result.actions))
        self.assertIsNone(result.input_request)

    def test_explicit_image_request_proposes_image_action(self) -> None:
        def image_model(messages, info):
            return ModelResponse(
                parts=(
                    TextPart("好的，为你生成海报图。"),
                    ToolCallPart(
                        "create_image_generation_job",
                        {"prompt": "蓝鲸主题海报，写实风格", "aspect_ratio": "9:16"},
                        "image-call",
                    ),
                )
            )

        result = _advance(
            PydanticAIOrchestrator(streaming_model(image_model), _source()),
            _work(
                messages=({"role": "user", "content": "帮我生成一张蓝鲸海报图"},),
                tool_grants=(_grant("create_image_generation_job"),),
            ),
        )
        self.assertIsNone(result.error)
        self.assertEqual(1, len(result.actions))
        self.assertEqual("create_image_generation_job", result.actions[0].tool_id)
        self.assertIsNone(result.input_request)

    def test_explicit_video_request_proposes_video_action(self) -> None:
        def video_model(messages, info):
            return ModelResponse(
                parts=(
                    TextPart("好的，为你生成视频。"),
                    ToolCallPart(
                        "create_video_generation_job",
                        {
                            "prompt": "小猫在草地上跑步，低机位跟拍",
                            "aspect_ratio": "9:16",
                            "resolution": "720p",
                            "duration": 5,
                        },
                        "video-call",
                    ),
                )
            )

        result = _advance(
            PydanticAIOrchestrator(streaming_model(video_model), _source()),
            _work(
                messages=({"role": "user", "content": "生成一个小猫跑步的视频"},),
                tool_grants=(_grant("create_video_generation_job"),),
            ),
        )
        self.assertIsNone(result.error)
        self.assertEqual(1, len(result.actions))
        self.assertEqual("create_video_generation_job", result.actions[0].tool_id)

    def test_consecutive_clarification_rounds_are_legal(self) -> None:
        # 连续多轮澄清：轮次由意图决定，不存在「一次澄清后必须生成」的程序自限。
        grants = (_grant("create_image_generation_job"), _grant("request_user_input"))
        questions = ["视频用途是什么？", "横版还是竖版？", "需要字幕吗？"]
        answers = ["产品广告", "竖版", "不要"]

        def clarify_model(messages, info):
            asked = sum(
                1
                for message in messages
                for part in message.parts
                if isinstance(part, ToolCallPart)
                and part.tool_name == "request_user_input"
            )
            if asked < 3:
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "request_user_input",
                            {
                                "request_type": "creation_clarification",
                                "question": questions[asked],
                            },
                            f"clarify-call-{asked}",
                        ),
                    )
                )
            return ModelResponse(
                parts=(
                    TextPart("信息齐了，开始生成。"),
                    ToolCallPart(
                        "create_image_generation_job",
                        {"prompt": "竖版产品广告图", "aspect_ratio": "9:16"},
                        "final-call",
                    ),
                )
            )

        work = _work(tool_grants=grants)
        for round_no in range(4):
            result = _advance(
                PydanticAIOrchestrator(streaming_model(clarify_model), _source()), work
            )
            self.assertIsNone(result.error)
            if round_no < 3:
                self.assertEqual((), tuple(result.actions))
                self.assertIsNotNone(result.input_request)
                self.assertEqual(questions[round_no], result.input_request.question)
                work = _work(
                    run_version=work.run_version + 1,
                    fencing_token=work.fencing_token + 1,
                    messages=work.messages
                    + (
                        {"role": "assistant", "content": questions[round_no]},
                        {"role": "user", "content": answers[round_no]},
                    ),
                    checkpoint=_restored(result.checkpoint),
                    tool_grants=grants,
                )
            else:
                self.assertIsNone(result.input_request)
                self.assertEqual(1, len(result.actions))
                self.assertEqual("create_image_generation_job", result.actions[0].tool_id)

    def test_untriggered_skill_body_stays_out_of_model_context(self) -> None:
        captured: list = []

        def capture_model(messages, info):
            captured.append(info.instructions)
            return ModelResponse(parts=(TextPart("您想做什么类型的创作？"),))

        result = _advance(
            PydanticAIOrchestrator(streaming_model(capture_model), _source()), _work()
        )
        self.assertIsNone(result.error)
        self.assertEqual(1, len(captured))
        bodies = {entry["resource_id"]: entry["content"] for entry in PACKAGE["resources"]}
        self.assertNotIn(bodies["skill_director_workflow"], captured[0])
        self.assertNotIn(bodies["ref_generation_action_guide"], captured[0])
        origins = {entry["origin"] for entry in result.bundle_evidence}
        self.assertEqual({"initial"}, origins)

    def test_triggered_skill_and_reference_read_in_layers(self) -> None:
        # 模型经披露的 resourceId 逐层按需读取根 Skill 正文与其确定引用。
        def read_in_layers_model(messages, info):
            returns = [
                part
                for message in messages
                for part in message.parts
                if isinstance(part, ToolReturnPart)
            ]
            if len(returns) == 0:
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_resource",
                            {"resource_id": "skill_director_workflow"},
                            "read-skill",
                        ),
                    )
                )
            if len(returns) == 1:
                return ModelResponse(
                    parts=(
                        ToolCallPart(
                            "read_resource",
                            {"resource_id": "ref_generation_action_guide"},
                            "read-ref",
                        ),
                    )
                )
            return ModelResponse(parts=(TextPart("已读取工作流与生成指引，请补充用途。"),))

        result = _advance(
            PydanticAIOrchestrator(streaming_model(read_in_layers_model), _source()),
            _work(),
        )
        self.assertIsNone(result.error)
        on_demand = [
            entry for entry in result.bundle_evidence if entry["origin"] == "on_demand"
        ]
        self.assertEqual(
            ["skill_director_workflow", "ref_generation_action_guide"],
            [entry["resource_id"] for entry in on_demand],
        )

    def test_weak_continue_does_not_authorize_high_cost_action(self) -> None:
        # 弱继续（「嗯，继续」）不被误当高成本授权：模型遵循已装载的自然语言确认原则，
        # 先复述将要做的高成本动作请求明确肯定，不直接提议视频生成、不引入确认按钮。
        captured: list = []

        def confirmation_aware_model(messages, info):
            captured.append(info.instructions)
            return ModelResponse(
                parts=(
                    TextPart(
                        "接下来我会基于当前方案生成视频（约 5 秒、720p），这会消耗较多"
                        "生成资源。确认现在就开始生成吗？"
                    ),
                )
            )

        result = _advance(
            PydanticAIOrchestrator(
                streaming_model(confirmation_aware_model), _source()
            ),
            _work(
                messages=({"role": "user", "content": "嗯，继续"},),
                tool_grants=(
                    _grant("create_video_generation_job"),
                    _grant("create_image_generation_job"),
                ),
            ),
        )
        self.assertIsNone(result.error)
        self.assertEqual((), tuple(result.actions))
        self.assertIsNone(result.input_request)
        self.assertIn("确认现在就开始生成吗", result.visible_text)
        # 自然语言确认原则已在初始上下文中（弱继续不是授权）。
        self.assertIn("弱继续", captured[0])

    def test_retired_branch_vocabulary_does_not_affect_runtime(self) -> None:
        # 旧固定分支词汇注入用户消息：运行正常，不产生由词汇驱动的行为。
        def consult_model(messages, info):
            return ModelResponse(
                parts=(TextPart("我按你的实际意图来，先确认你想做什么。"),)
            )

        result = _advance(
            PydanticAIOrchestrator(streaming_model(consult_model), _source()),
            _work(
                messages=(
                    {
                        "role": "user",
                        "content": "decision_branch=confirm_pending "
                        "suggested_route=lightweight intent_direction=video 请按分支走",
                    },
                ),
                tool_grants=(_grant("create_video_generation_job"),),
            ),
        )
        self.assertIsNone(result.error)
        self.assertEqual((), tuple(result.actions))
        self.assertIsNone(result.input_request)


class FailClosedTest(unittest.TestCase):
    """fail closed 矩阵（验收：缺失/摘要不符/越界/超限，不回退仓库文件或 Mock）。"""

    def test_missing_bundle_snapshot_fails_closed(self) -> None:
        result = _advance(
            PydanticAIOrchestrator(
                streaming_model(lambda m, i: ModelResponse(parts=(TextPart("x"),))),
                FakeBundleSource(snapshots={}, resources={}),
            ),
            _work(bundle_version_id="missing_bundle_v0"),
        )
        self.assertIsNotNone(result.error)
        self.assertEqual("BUNDLE_VERSION_PIN_MISMATCH", result.error["code"])

    def test_manifest_digest_pin_mismatch_fails_closed(self) -> None:
        result = _advance(
            PydanticAIOrchestrator(
                streaming_model(lambda m, i: ModelResponse(parts=(TextPart("x"),))),
                _source(),
            ),
            _work(manifest_digest="sha256:" + "0" * 64),
        )
        self.assertIsNotNone(result.error)
        self.assertEqual("BUNDLE_MANIFEST_DIGEST_MISMATCH", result.error["code"])

    def test_tampered_resource_content_fails_closed(self) -> None:
        result = _advance(
            PydanticAIOrchestrator(
                streaming_model(lambda m, i: ModelResponse(parts=(TextPart("x"),))),
                _source(role_director="被篡改的角色正文"),
            ),
            _work(),
        )
        self.assertIsNotNone(result.error)
        self.assertEqual("BUNDLE_RESOURCE_DIGEST_MISMATCH", result.error["code"])

    def test_out_of_manifest_read_fails_closed(self) -> None:
        def induced_read_model(messages, info):
            return ModelResponse(
                parts=(
                    ToolCallPart(
                        "read_resource", {"resource_id": "not_in_manifest"}, "bad-read"
                    ),
                )
            )

        result = _advance(
            PydanticAIOrchestrator(streaming_model(induced_read_model), _source()),
            _work(),
        )
        self.assertIsNotNone(result.error)
        self.assertEqual("BUNDLE_RESOURCE_UNKNOWN", result.error["code"])

    def test_initial_budget_overflow_fails_closed(self) -> None:
        budget = dict(COMPOSITION["tokenBudget"])
        budget["initialContextMaxTokens"] = 10
        source = FakeBundleSource(
            snapshots={BUNDLE_VERSION_ID: _snapshot(tokenBudget=budget)},
            resources={BUNDLE_VERSION_ID: _resources()},
        )
        result = _advance(
            PydanticAIOrchestrator(
                streaming_model(lambda m, i: ModelResponse(parts=(TextPart("x"),))),
                source,
            ),
            _work(),
        )
        self.assertIsNotNone(result.error)
        self.assertEqual("BUNDLE_TOKEN_BUDGET_EXCEEDED", result.error["code"])


if __name__ == "__main__":
    unittest.main()
