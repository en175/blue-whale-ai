"""原型验证测试（工单 IK2D8I）。

一条命令运行：
    cd blue_whale_agent_worker && .venv/bin/python -m pytest tests/test_prototype_bundle_runtime.py -q

全部使用 FunctionModel 假 Provider 与内存 FakeGateway：无网络、无付费请求、
不触碰正式业务链路。每个测试对应票据的一个验证问题。
"""

import asyncio
import json
from dataclasses import replace

import pytest
from pydantic_ai.messages import (
    ModelResponse,
    TextPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

from blue_whale_agent_worker.prototype.bundle import (
    BUNDLE_MANIFEST_DIGEST_MISMATCH,
    BUNDLE_RESOURCE_DIGEST_MISMATCH,
    BUNDLE_RESOURCE_UNKNOWN,
    BUNDLE_TOKEN_BUDGET_EXCEEDED,
    BUNDLE_VERSION_PIN_MISMATCH,
    MODEL_CAPABILITY_INSUFFICIENT,
    PROTOCOL_MIXED_STREAM,
    PROTOCOL_PENDING_CALL_MISMATCH,
    STREAM_IDEMPOTENCY_CONFLICT,
    BundleError,
    ModelProfileSpec,
    TokenBudget,
    build_snapshot,
    estimate_tokens,
    sha256_text,
)
from blue_whale_agent_worker.prototype.gateway import FakeGateway
from blue_whale_agent_worker.prototype.runtime import (
    CHUNK_WINDOW,
    BundleAgentRuntime,
    ProtoRunWork,
)

ROLE_V1 = "# 角色：蓝鲸创作导演 v1\n你负责把用户的创作意图推进到可生成。"
ROLE_V2 = "# 角色：蓝鲸创作导演 v2\n你负责把用户的创作意图推进到可生成（修订）。"
RULE_ALWAYS = "规则：永远先确认风格与比例再提出生成动作。"
RULE_ON_DEMAND = "规则：水墨风格需留白三分。（按需正文，不进入初始上下文）"
SKILL_BODY = "# 创作工作流 Skill\n1. 澄清 2. 读取 ref-shot 模板 3. 提出动作。"
REF_BODY = "参考：分镜模板 = 主体/氛围/比例 三段式。"
CAPABLE_PROFILE = ModelProfileSpec("fake-capable", frozenset({"text", "tool_calling"}))
GENEROUS_BUDGET = TokenBudget(
    initial_context_max_tokens=2000,
    single_resource_max_tokens=1000,
    active_context_max_tokens=4000,
)


def make_snapshot(
    budget=GENEROUS_BUDGET,
    profile=CAPABLE_PROFILE,
    bundle_version_id="bundle-1",
    version="1.0.0",
    role=ROLE_V1,
):
    return build_snapshot(
        bundle_version_id=bundle_version_id,
        version=version,
        resources=[
            ("role-1", "role_document", "role/AGENTS.md", "always_on", role, "", ()),
            ("rule-always", "rule", "rules/always.md", "always_on", RULE_ALWAYS, "", ()),
            (
                "rule-style",
                "rule",
                "rules/style.md",
                "on_demand",
                RULE_ON_DEMAND,
                "",
                (),
            ),
            (
                "skill-main",
                "runtime_skill",
                "skills/main/SKILL.md",
                "on_demand",
                SKILL_BODY,
                "根创作工作流 Skill",
                ("ref-shot",),
            ),
            ("ref-shot", "reference", "skills/main/shot.md", "on_demand", REF_BODY, "", ()),
        ],
        budget=budget,
        model_profile=profile,
    )


def make_work(snapshot, prompt, *, stream_id="s1", checkpoint=None, accepted=None):
    return ProtoRunWork(
        agent_run_id=7,
        run_version=1,
        stream_id=stream_id,
        prompt=prompt,
        pinned_bundle_version_id=snapshot.bundle_version_id,
        expected_manifest_digest=snapshot.manifest_digest,
        checkpoint=checkpoint,
        accepted_results=accepted or {},
    )


class RecordingGateway(FakeGateway):
    def __init__(self):
        super().__init__()
        self.appended = []
        self.completed = []

    def append_assistant_message_chunk(self, run_id, payload):
        self.appended.append(dict(payload))
        super().append_assistant_message_chunk(run_id, payload)

    def complete_assistant_message(self, run_id, payload):
        self.completed.append(dict(payload))
        super().complete_assistant_message(run_id, payload)


def run(coro):
    return asyncio.run(coro)


# ---- 假 Provider 行为库（FunctionModel stream_function） ----


def text_model(text: str):
    async def sfn(messages, info):
        third = max(1, len(text) // 3)
        for i in range(0, len(text), third):
            yield text[i : i + third]

    return FunctionModel(stream_function=sfn)


def clarify_then_act_model(calls_seen=None):
    """第 1/2 轮各提一个澄清问题，第 3 轮提出 deferred 生图动作；恢复后给最终文本。"""

    async def sfn(messages, info):
        if any(
            isinstance(p, ToolReturnPart) and p.tool_name == "generate_image"
            for m in messages
            for p in m.parts
        ):
            yield "图片已经生成：蓝鲸海报。"
            return
        asked = sum(
            1
            for m in messages
            if isinstance(m, ModelResponse)
            and any(isinstance(p, TextPart) for p in m.parts)
        )
        if asked == 0:
            yield "您想要什么风格？"
        elif asked == 1:
            yield "横幅还是方图？"
        else:
            yield {
                0: DeltaToolCall(
                    name="generate_image",
                    json_args='{"prompt": "蓝鲸海报，水墨风格"}',
                    tool_call_id="provider-private-call-007",
                )
            }

    return FunctionModel(stream_function=sfn)


def skill_reader_model(seen):
    """先读 skill-main，按其正文指引读 ref-shot，然后输出最终文本。"""

    async def sfn(messages, info):
        reads = [
            str(p.content)
            for m in messages
            for p in m.parts
            if isinstance(p, ToolReturnPart) and p.tool_name == "read_resource"
        ]
        if not reads:
            yield {
                0: DeltaToolCall(
                    name="read_resource",
                    json_args='{"resource_id": "skill-main"}',
                    tool_call_id="rr-1",
                )
            }
            return
        seen.extend(reads)
        if any(SKILL_BODY[:20] in content for content in reads) and not any(
            REF_BODY[:20] in content for content in reads
        ):
            yield {
                0: DeltaToolCall(
                    name="read_resource",
                    json_args='{"resource_id": "ref-shot"}',
                    tool_call_id="rr-2",
                )
            }
            return
        yield "已按 Skill 与分镜模板完成创作说明。"

    return FunctionModel(stream_function=sfn)


def fixed_resource_reader(resource_id):
    async def sfn(messages, info):
        if any(
            isinstance(p, ToolReturnPart) for m in messages for p in m.parts
        ):
            yield "读完了。"
            return
        yield {
            0: DeltaToolCall(
                name="read_resource",
                json_args=json.dumps({"resource_id": resource_id}),
                tool_call_id="rr-x",
            )
        }

    return FunctionModel(stream_function=sfn)


def mixed_stream_model():
    """同一流式响应既给 deferred 工具调用又给文本（实测 2.9.0 会静默丢动作）。"""

    async def sfn(messages, info):
        yield {
            0: DeltaToolCall(
                name="generate_image",
                json_args='{"prompt": "蓝鲸"}',
                tool_call_id="mix-1",
            )
        }
        yield "这是混在一起的文本。"

    return FunctionModel(stream_function=sfn)


def reader_then_action_model():
    """先读 skill-main 与 ref-shot，再提出 deferred 动作；恢复后给最终文本。"""

    async def sfn(messages, info):
        if any(
            isinstance(p, ToolReturnPart) and p.tool_name == "generate_image"
            for m in messages
            for p in m.parts
        ):
            yield "图片已经生成：按模板完成。"
            return
        reads = [
            p
            for m in messages
            for p in m.parts
            if isinstance(p, ToolReturnPart) and p.tool_name == "read_resource"
        ]
        if not reads:
            yield {
                0: DeltaToolCall(
                    name="read_resource",
                    json_args='{"resource_id": "skill-main"}',
                    tool_call_id="rr-1",
                )
            }
            return
        if len(reads) == 1:
            yield {
                0: DeltaToolCall(
                    name="read_resource",
                    json_args='{"resource_id": "ref-shot"}',
                    tool_call_id="rr-2",
                )
            }
            return
        yield {
            0: DeltaToolCall(
                name="generate_image",
                json_args='{"prompt": "蓝鲸海报"}',
                tool_call_id="img-1",
            )
        }

    return FunctionModel(stream_function=sfn)


# ---- 1. 动态 instructions：每个 AgentRun 注入版本化 Bundle ----


def test_dynamic_instructions_reach_model_per_run():
    captured = []

    async def sfn(messages, info):
        captured.append(info.instructions)
        yield "好。"

    snapshot_v1 = make_snapshot(bundle_version_id="bundle-1", version="1.0.0", role=ROLE_V1)
    snapshot_v2 = make_snapshot(bundle_version_id="bundle-2", version="2.0.0", role=ROLE_V2)

    for snapshot in (snapshot_v1, snapshot_v2):
        runtime = BundleAgentRuntime(snapshot, FunctionModel(stream_function=sfn))
        gateway = RecordingGateway()
        outcome = run(runtime.advance(make_work(snapshot, "hi"), gateway))
        assert outcome.input_request == "好。"

    assert len(captured) == 2
    v1_instructions, v2_instructions = captured
    # 版本化身份与 RoleDocument 按固定版本注入，两个 Run 互不串味
    assert "bundle-1" in v1_instructions and ROLE_V1 in v1_instructions
    assert "bundle-2" in v2_instructions and ROLE_V2 in v2_instructions
    assert ROLE_V2 not in v1_instructions
    # always_on Rule 进入初始上下文；on_demand 正文与 Skill 正文不进入
    assert RULE_ALWAYS in v1_instructions
    assert RULE_ON_DEMAND not in v1_instructions
    assert SKILL_BODY not in v1_instructions
    assert "skill-main" in v1_instructions  # Skill 只披露元数据


def test_pin_and_manifest_digest_fail_closed():
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, text_model("x"))
    with pytest.raises(BundleError) as exc:
        work = make_work(snapshot, "hi")
        run(
            runtime.advance(
                ProtoRunWork(
                    **{**work.__dict__, "pinned_bundle_version_id": "bundle-other"}
                ),
                RecordingGateway(),
            )
        )
    assert exc.value.code == BUNDLE_VERSION_PIN_MISMATCH

    with pytest.raises(BundleError) as exc:
        work = make_work(snapshot, "hi")
        run(
            runtime.advance(
                ProtoRunWork(
                    **{**work.__dict__, "expected_manifest_digest": "sha256:" + "0" * 64}
                ),
                RecordingGateway(),
            )
        )
    assert exc.value.code == BUNDLE_MANIFEST_DIGEST_MISMATCH


# ---- 2. 资源按需读取、引用跟随与已读证据 ----


def test_on_demand_skill_read_with_reference_and_evidence():
    snapshot = make_snapshot()
    seen = []
    runtime = BundleAgentRuntime(snapshot, skill_reader_model(seen))
    gateway = RecordingGateway()
    outcome = run(runtime.advance(make_work(snapshot, "帮我做海报"), gateway))

    assert outcome.input_request == "已按 Skill 与分镜模板完成创作说明。"
    # 模型确实通过受限工具读到了 Skill 正文与其引用资源
    assert any(SKILL_BODY[:20] in content for content in seen)
    assert any(REF_BODY[:20] in content for content in seen)
    read_ids = [r["resource_id"] for r in outcome.evidence["resources_read"]]
    assert "skill-main" in read_ids and "ref-shot" in read_ids
    origins = {r["resource_id"]: r["origin"] for r in outcome.evidence["resources_read"]}
    assert origins["skill-main"] == "on_demand"
    assert origins["role-1"] == "initial"
    assert outcome.evidence["manifest_digest"] == snapshot.manifest_digest
    # 全部可见文本经分块协议发布
    assert gateway.released_text("s1") == "已按 Skill 与分镜模板完成创作说明。"


def test_read_unknown_resource_fails_closed():
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, fixed_resource_reader("rule-不存在"))
    with pytest.raises(BundleError) as exc:
        run(runtime.advance(make_work(snapshot, "hi"), RecordingGateway()))
    assert exc.value.code == BUNDLE_RESOURCE_UNKNOWN


def test_resource_budget_fail_closed_without_truncation():
    snapshot = make_snapshot()
    skill_tokens = estimate_tokens(SKILL_BODY)

    # 单资源上限：skill-main 超限时读取被拒，run 失败而非静默截断
    tight_single = TokenBudget(2000, skill_tokens - 1, 4000)
    snapshot_single = make_snapshot(budget=tight_single)
    runtime = BundleAgentRuntime(snapshot_single, fixed_resource_reader("skill-main"))
    with pytest.raises(BundleError) as exc:
        run(runtime.advance(make_work(snapshot_single, "hi"), RecordingGateway()))
    assert exc.value.code == BUNDLE_TOKEN_BUDGET_EXCEEDED

    # 活动上下文上限：初始装载后余量不足时同样拒绝
    initial_tokens = estimate_tokens(ROLE_V1) + estimate_tokens(RULE_ALWAYS)
    tight_active = TokenBudget(2000, 1000, initial_tokens + skill_tokens - 1)
    snapshot_active = make_snapshot(budget=tight_active)
    runtime = BundleAgentRuntime(snapshot_active, fixed_resource_reader("skill-main"))
    with pytest.raises(BundleError) as exc:
        run(runtime.advance(make_work(snapshot_active, "hi"), RecordingGateway()))
    assert exc.value.code == BUNDLE_TOKEN_BUDGET_EXCEEDED


def test_resource_digest_mismatch_fails_closed():
    """资源字节与 manifest 固化摘要不符：读取 fail closed。

    原型用 replace 篡改快照来模拟生产形态（publisher 固化摘要、Worker 另载字节），
    build_snapshot 自算摘要的便利性不影响闸门语义。
    """
    base = make_snapshot()
    target = next(r for r in base.resources if r.resource_id == "rule-style")
    tampered = replace(target, content_digest="sha256:" + "0" * 64)
    snapshot = replace(
        base,
        resources=tuple(
            tampered if r.resource_id == target.resource_id else r
            for r in base.resources
        ),
    )
    runtime = BundleAgentRuntime(snapshot, fixed_resource_reader("rule-style"))
    with pytest.raises(BundleError) as exc:
        run(runtime.advance(make_work(snapshot, "hi"), RecordingGateway()))
    assert exc.value.code == BUNDLE_RESOURCE_DIGEST_MISMATCH


def test_initial_context_budget_blocks_run():
    initial_tokens = (
        estimate_tokens(ROLE_V1)
        + estimate_tokens(RULE_ALWAYS)
        + estimate_tokens("skill-main 根创作工作流 Skill")
    )
    snapshot = make_snapshot(
        budget=TokenBudget(initial_tokens - 1, 1000, 4000)
    )
    runtime = BundleAgentRuntime(snapshot, text_model("x"))
    with pytest.raises(BundleError) as exc:
        run(runtime.advance(make_work(snapshot, "hi"), RecordingGateway()))
    assert exc.value.code == BUNDLE_TOKEN_BUDGET_EXCEEDED


# ---- 3. 两次以上 UserInputRequest + deferred 动作 + checkpoint 恢复 ----


def _three_advances(snapshot, runtime, gateway):
    outcome1 = run(runtime.advance(make_work(snapshot, "生成海报", stream_id="s1"), gateway))
    outcome2 = run(
        runtime.advance(
            make_work(snapshot, "水墨风格", stream_id="s2", checkpoint=outcome1.checkpoint_payload),
            gateway,
        )
    )
    outcome3 = run(
        runtime.advance(
            make_work(snapshot, "方图", stream_id="s3", checkpoint=outcome2.checkpoint_payload),
            gateway,
        )
    )
    return outcome1, outcome2, outcome3


def test_two_clarification_rounds_then_action():
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, clarify_then_act_model())
    gateway = RecordingGateway()
    outcome1, outcome2, outcome3 = _three_advances(snapshot, runtime, gateway)

    # 两次以上 UserInputRequest：现正式 Adapter 禁止第二问，原型证明框架不限制
    assert outcome1.input_request == "您想要什么风格？"
    assert outcome2.input_request == "横幅还是方图？"
    assert outcome1.actions == () and outcome2.actions == ()
    # 第三论提出且只提出一个 deferred 动作，pending call 进入 checkpoint
    assert len(outcome3.actions) == 1
    assert outcome3.actions[0]["action_type"] == "generate_image"
    assert outcome3.actions[0]["arguments"]["prompt"] == "蓝鲸海报，水墨风格"
    assert outcome3.pending_calls[0]["tool_call_id"] == "provider-private-call-007"
    assert gateway.released_text("s1") == "您想要什么风格？"
    assert gateway.released_text("s2") == "横幅还是方图？"
    assert gateway.released_text("s3") == ""  # 动作轮无可见文本、不产生分块

    # 工具结果恢复：deferred_tool_results + message_history 组合推进到最终文本
    outcome4 = run(
        runtime.advance(
            make_work(
                snapshot,
                None,
                stream_id="s4",
                checkpoint=outcome3.checkpoint_payload,
                accepted={
                    "provider-private-call-007": {
                        "status": "succeeded",
                        "result": {"asset_id": 42},
                    }
                },
            ),
            gateway,
        )
    )
    assert outcome4.input_request == "图片已经生成：蓝鲸海报。"
    assert outcome4.actions == ()
    assert gateway.released_text("s4") == "图片已经生成：蓝鲸海报。"


def test_pending_call_mismatch_fails_closed():
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, clarify_then_act_model())
    gateway = RecordingGateway()
    _, _, outcome3 = _three_advances(snapshot, runtime, gateway)
    with pytest.raises(BundleError) as exc:
        run(
            runtime.advance(
                make_work(
                    snapshot,
                    None,
                    stream_id="s5",
                    checkpoint=outcome3.checkpoint_payload,
                    accepted={"别的-call-id": {"status": "succeeded", "result": {}}},
                ),
                gateway,
            )
        )
    assert exc.value.code == PROTOCOL_PENDING_CALL_MISMATCH


def test_read_ledger_rebuilt_from_checkpoint_history():
    """契约 §6：checkpoint 不嵌 Bundle 内容；已读账本从消息历史确定性重建。"""
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, reader_then_action_model())
    gateway = RecordingGateway()
    outcome1 = run(runtime.advance(make_work(snapshot, "做海报", stream_id="s1"), gateway))
    assert len(outcome1.actions) == 1

    outcome2 = run(
        runtime.advance(
            make_work(
                snapshot,
                None,
                stream_id="s2",
                checkpoint=outcome1.checkpoint_payload,
                accepted={"img-1": {"status": "succeeded", "result": {"asset_id": 1}}},
            ),
            gateway,
        )
    )
    origins = {r["resource_id"]: r["origin"] for r in outcome2.evidence["resources_read"]}
    assert origins["skill-main"] == "history"
    assert origins["ref-shot"] == "history"
    assert gateway.released_text("s2") == "图片已经生成：按模板完成。"


def test_history_restore_budget_fail_closed():
    """恢复路径回填账本同样过活动预算闸门：超预算 fail closed，不因恢复放宽。"""
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, reader_then_action_model())
    gateway = RecordingGateway()
    outcome1 = run(runtime.advance(make_work(snapshot, "做海报", stream_id="s1"), gateway))
    assert len(outcome1.actions) == 1

    skill_tokens = estimate_tokens(SKILL_BODY)
    initial_tokens = estimate_tokens(ROLE_V1) + estimate_tokens(RULE_ALWAYS)
    tight = TokenBudget(2000, 1000, initial_tokens + skill_tokens - 1)
    tight_snapshot = make_snapshot(budget=tight)
    tight_runtime = BundleAgentRuntime(tight_snapshot, reader_then_action_model())
    with pytest.raises(BundleError) as exc:
        run(
            tight_runtime.advance(
                make_work(
                    tight_snapshot,
                    None,
                    stream_id="s2",
                    checkpoint=outcome1.checkpoint_payload,
                    accepted={"img-1": {"status": "succeeded", "result": {"asset_id": 1}}},
                ),
                gateway,
            )
        )
    assert exc.value.code == BUNDLE_TOKEN_BUDGET_EXCEEDED


# ---- 4. 文本分块协议与 provider 字段隔离 ----


def test_text_chunking_protocol_and_provider_hygiene():
    snapshot = make_snapshot()
    text = "第一段：蓝鲸在宣纸上游动。" * 20  # 260 字符，跨 5 个 64 字符窗，含中文
    runtime = BundleAgentRuntime(snapshot, text_model(text))
    gateway = RecordingGateway()
    outcome = run(runtime.advance(make_work(snapshot, "hi"), gateway))

    assert len(gateway.appended) >= 3
    seqs = [c["seq"] for c in gateway.appended]
    assert seqs == list(range(1, len(seqs) + 1))  # 序号连续
    for chunk in gateway.appended:
        assert len(chunk["idempotency_key"]) <= 64
        assert len(chunk["text"]) <= CHUNK_WINDOW
        # 分块只携带消毒后文本与协议字段
        assert set(chunk) == {"stream_id", "seq", "idempotency_key", "text"}
    joined = "".join(c["text"] for c in gateway.appended)
    assert joined == text
    assert gateway.completed[0]["digest"] == sha256_text(text)
    # 发布门语义：complete 之前无可见文本，之后全文一致
    assert gateway.released_text("s1") == text
    # provider 私有字段（tool_call_id 等）不进入任何分块协议载荷
    assert "provider-private" not in json.dumps(gateway.appended + gateway.completed)
    assert outcome.visible_text == text


def test_chunk_idempotency_dedup_and_conflict():
    gateway = RecordingGateway()
    gateway.start_assistant_message(7, {"stream_id": "s1"})
    chunk = {
        "stream_id": "s1",
        "seq": 1,
        "idempotency_key": "proto-7-1-s1-c00001",
        "text": "甲",
    }
    gateway.append_assistant_message_chunk(7, chunk)
    gateway.append_assistant_message_chunk(7, dict(chunk))  # 同键同文：幂等去重
    assert gateway.acked_seq("s1") == 1
    with pytest.raises(BundleError) as exc:  # 同键异文：拒绝静默覆盖
        gateway.append_assistant_message_chunk(7, {**chunk, "text": "乙"})
    assert exc.value.code == STREAM_IDEMPOTENCY_CONFLICT

    gateway.complete_assistant_message(
        7, {"stream_id": "s1", "digest": sha256_text("甲"), "chunk_count": 1}
    )
    assert gateway.released_text("s1") == "甲"


def test_duplicate_commit_idempotent():
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, text_model("问一句。"))
    gateway = RecordingGateway()
    outcome = run(runtime.advance(make_work(snapshot, "hi"), gateway))
    payload = outcome.to_commit_payload()
    assert gateway.commit(7, payload) is True
    assert gateway.commit(7, dict(payload)) is False  # 重复提交不产生二次效果
    assert gateway.duplicate_commits == 1


# ---- 5. 取消/断连与重放 ----


def test_cancel_aborts_stream_and_replay_on_new_stream_recovers():
    snapshot = make_snapshot()
    started = asyncio.Event()

    async def hanging(messages, info):
        yield "已开头的第一段文本，" * 8
        started.set()
        await asyncio.Event().wait()  # 永不返回：模拟模型/网络挂起
        yield  # pragma: no cover

    async def scenario():
        runtime = BundleAgentRuntime(snapshot, FunctionModel(stream_function=hanging))
        gateway = RecordingGateway()
        task = asyncio.create_task(
            runtime.advance(make_work(snapshot, "hi"), gateway)
        )
        await asyncio.wait_for(started.wait(), timeout=5)
        await asyncio.sleep(0)  # 让分块落库
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return gateway

    gateway = run(scenario())
    # 取消传播到框架；流被标记作废；未 complete 的私有分块永不释放
    assert gateway.is_aborted("s1")
    assert gateway.released_text("s1") == ""

    # 恢复策略（适配层规则）：整流作废，用新 stream_id 确定性重跑
    full_text = "重跑后完整生成的最终文本，内容与作废流无关。"
    runtime = BundleAgentRuntime(snapshot, text_model(full_text))
    outcome = run(
        runtime.advance(make_work(snapshot, "hi", stream_id="s1-retry"), gateway)
    )
    assert gateway.released_text("s1-retry") == full_text
    assert outcome.visible_text == full_text


def test_divergent_replay_fails_digest_seal():
    """同一 stream 上重放出不同文本：digest 封口必然失败（fail closed）。

    这是真流式 + 非确定性模型的结构性结论：attempt 重跑不能续写旧流，
    必须整流作废重建（见 NOTES.md 失败模式 F5）。
    """
    snapshot = make_snapshot()
    gateway = RecordingGateway()
    text_a = "甲版本：" + "甲" * 200
    runtime_a = BundleAgentRuntime(snapshot, text_model(text_a))
    run(runtime_a.advance(make_work(snapshot, "hi"), gateway))
    assert gateway.released_text("s1") == text_a

    # 同一 stream 上叠加重放的不同文本：complete 时全文 digest 对不上
    text_b = "乙版本：" + "乙" * 200
    runtime_b = BundleAgentRuntime(snapshot, text_model(text_b))
    with pytest.raises(BundleError) as exc:
        run(runtime_b.advance(make_work(snapshot, "hi"), gateway))
    assert exc.value.code == STREAM_IDEMPOTENCY_CONFLICT


# ---- 6. 混合流失败模式与模型能力门 ----


def test_mixed_stream_fails_closed():
    snapshot = make_snapshot()
    runtime = BundleAgentRuntime(snapshot, mixed_stream_model())
    with pytest.raises(BundleError) as exc:
        run(runtime.advance(make_work(snapshot, "hi"), RecordingGateway()))
    assert exc.value.code == PROTOCOL_MIXED_STREAM


def test_model_capability_gate_blocks_before_model_call():
    snapshot = make_snapshot(
        profile=ModelProfileSpec("fake-text-only", frozenset({"text"}))
    )
    called = []

    async def sfn(messages, info):
        called.append(True)
        yield "不应被调用"

    runtime = BundleAgentRuntime(snapshot, FunctionModel(stream_function=sfn))
    with pytest.raises(BundleError) as exc:
        run(runtime.advance(make_work(snapshot, "hi"), RecordingGateway()))
    assert exc.value.code == MODEL_CAPABILITY_INSUFFICIENT
    assert called == []  # 能力预检在调用模型之前 fail closed
