# 原型 NOTES：Pydantic AI 动态 Bundle、渐进装载与安全流式（IK2D8I）

> 可丢弃原型，回答工单 IK2D8I 的验证问题。被接纳的结论将迁入正式 Adapter，
> 本包随后删除。Parent map：IK2D7Z。

## 验证问题（票据原文）

1. 每个 AgentRun 动态注入版本化 `AGENTS.md` 与 always-on Rules 是否可靠。
2. 模型能否通过受限资源工具读取 `SKILL.md` 及其引用，并记录已读资源。
3. 文本流与 deferred tool request、checkpoint 恢复能否组合。
4. 如何在不暴露 provider 原始 token 的前提下形成可审核的合并文本块。
5. 取消/断连、重复提交和工具结果恢复时框架行为如何。
6. 不同允许模型对工具调用和结构化输出的兼容性。

## 运行方式

```bash
cd blue_whale_agent_worker
.venv/bin/python -m pytest tests/test_prototype_bundle_runtime.py -q   # 18 个测试
```

全部使用 `FunctionModel` 假 Provider 与内存 FakeGateway：无网络、无付费请求、
不触碰正式业务链路。框架版本：`pydantic-ai-slim==2.9.0`。

## 能力矩阵（2.9.0 实测）

| # | 能力 | 结论 | 证据（测试） |
|---|---|---|---|
| 1 | 每 Run 动态注入版本化 RoleDocument + always-on Rules | ✅ 可靠。每 Run 构造 `Agent(instructions=...)`，instructions 到达模型（`info.instructions` 可验证）；两个 BundleVersion 互不串味；on_demand 正文与 Skill 正文不进入初始上下文，Skill 只披露元数据 | `test_dynamic_instructions_reach_model_per_run` |
| 1b | Run pin 与 manifestDigest 校验 | ✅ fail closed：`BUNDLE_VERSION_PIN_MISMATCH` / `BUNDLE_MANIFEST_DIGEST_MISMATCH` | `test_pin_and_manifest_digest_fail_closed` |
| 2 | 受限 `read_resource` 工具按需读取 + 引用跟随 | ✅ 直接工具在流式运行中正常执行，`ctx.deps` 闸门记账（resource_id/revision/digest/origin），证据进 commit | `test_on_demand_skill_read_with_reference_and_evidence` |
| 2b | 已读账本跨 checkpoint 恢复 | ✅ 从消息历史 `ToolCallPart` 确定性重建（origin=history）；checkpoint 不嵌 Bundle 内容，契约 §6 成立 | `test_read_ledger_rebuilt_from_checkpoint_history` |
| 2c | token 预算三门（初始/单资源/活动），恢复路径同门 | ✅ fail closed 且不截断：`BUNDLE_TOKEN_BUDGET_EXCEEDED`；checkpoint 恢复回填账本时同样过活动预算门，不因恢复放宽 | `test_initial_context_budget_blocks_run`、`test_resource_budget_fail_closed_without_truncation`、`test_history_restore_budget_fail_closed` |
| 2d | 资源字节与 manifest 固化摘要不符 | ✅ fail closed：`BUNDLE_RESOURCE_DIGEST_MISMATCH`（原型用篡改快照模拟 publisher 摘要与字节分离） | `test_resource_digest_mismatch_fails_closed` |
| 3 | 文本流 + deferred tool request + checkpoint 恢复组合 | ✅ 组合成立。纯工具流响应下 `stream_text` 抛 `UserError`，catch 后 `get_output()` 正常返回 `DeferredToolRequests`；`run_stream` 与 `run_sync` 一样接受 `message_history` + `deferred_tool_results` | `test_two_clarification_rounds_then_action` |
| 3b | 两次以上 UserInputRequest（多轮澄清） | ✅ 框架不限制澄清轮次；现正式 Adapter「澄清恢复后必须出动作」的自限可以解除 | `test_two_clarification_rounds_then_action` |
| 4 | 不暴露 provider 原始字段的可审核合并文本块 | ✅ 64 字符窗、连续 seq、≤64 字符确定性幂等键、全文 digest 封口、complete 前零可见文本；chunk 载荷只有 `{stream_id, seq, idempotency_key, text}`，provider 的 tool_call_id 等私有字段只在 checkpoint 私有区 | `test_text_chunking_protocol_and_provider_hygiene` |
| 5a | 取消/断连 | ✅ `CancelledError` 从流中正常传播；abort 后未 complete 的私有分块永不释放；整流作废 + 新 stream_id 确定性重跑可恢复 | `test_cancel_aborts_stream_and_replay_on_new_stream_recovers` |
| 5b | 重复提交 / 重放 | ✅ commit_id 幂等去重；同键同文 chunk 去重；同键异文拒绝 | `test_duplicate_commit_idempotent`、`test_chunk_idempotency_dedup_and_conflict` |
| 5c | 工具结果恢复 | ✅ `DeferredToolResults` 与 pending calls 对齐校验；不匹配 fail closed（`PROTOCOL_PENDING_CALL_MISMATCH`） | `test_pending_call_mismatch_fails_closed` |
| 6 | 模型能力兼容 | ✅ 适配层预检 ModelProfile capabilities：缺 `tool_calling` 在调用模型之前 fail closed（`MODEL_CAPABILITY_INSUFFICIENT`）。⚠️ 真实 provider 行为未实测（见 F5） | `test_model_capability_gate_blocks_before_model_call` |

## 失败模式（实测发现，正式实现必须处理）

- **F1 混合流静默丢动作**（`PROTOCOL_MIXED_STREAM`）：同一流式响应既含 deferred
  工具调用又含文本时，`get_output()` 返回 `str` 并**静默丢弃** deferred 请求
  （同步路径无此问题，正确返回 `DeferredToolRequests`）。适配层必须在
  `get_output()` 为 str 时扫描最终响应中的 deferred `ToolCallPart` 并 fail closed，
  交由规范轮重试；同时用 Bundle Rule 约束「动作响应不夹带正文」降低触发率。
  证据：`test_mixed_stream_fails_closed`。
- **F2 纯工具流响应下 `stream_text` 抛 `UserError`**：属框架正常行为而非错误，
  流式消费者必须 catch 后走 `get_output()`；不处理会把正常动作轮当异常。
- **F3 真流式 + 非确定性重放不可续写**：同一 stream 上重放出不同文本时，全文
  digest 封口必然失败（fail closed 有效），即 attempt 取消后**不能续写旧流**。
  适配层规则：取消/断连即 abort 整流、用新 stream_id 重跑；gateway 对同键异文
  拒绝覆盖。证据：`test_divergent_replay_fails_digest_seal`。
  前提：`ChunkFormer(skip_chars=acked * CHUNK_WINDOW)` 假设已确认分块均为满
  64 字符窗——尾部分块只在 `finish()` 后落 gateway；同文重放依赖 gateway 已持有
  全部分块 + digest 封口兜底，异文重放必然封口失败，不存在「错误成功」。
- **F4 资源读取失败直接终结 run**：`read_resource` 抛出 `BundleError` 会穿透
  pydantic-ai 的工具循环（非 `ModelRetry` 不重试），符合 fail closed；适配层需在
  Worker 边界捕获并把 `code` 映射为规范化错误提交给 Java，而不是裸 500。
- **F5 真实 provider 未实测**：本矩阵全部来自 Fake Provider。真实模型的
  tool calling / 流式 / deferred 组合（含各 provider 对混合响应的实际行为）
  由发布门票据（IK2D8U）的 live smoke 承接；本票按验收要求不产生付费请求。
  结构化输出兼容性同样未覆盖：能力预检只要求 `{text, tool_calling}`，
  `structured_output` 不在 `REQUIRED_CAPABILITIES`，随真实模型矩阵一并由 IK2D8U 承接。

## 建议适配层（对正式实现的约束）

1. 每 AgentRun 构造 `Agent`，`instructions` 来自固定快照的
   `initial_instructions()`（RoleDocument + always_on Rules + Skill 元数据索引）；
   生产路径删除硬编码提示词。
2. `read_resource` 用**直接工具**（非 deferred）+ `ResourceGate`
   （pin/digest/预算/记账）；外部副作用动作继续走 deferred 白名单。
3. 流式消费者固定形态：`try: stream_text(delta=True) except UserError: pass` →
   `get_output()` → 混合流检测（F1）；**所有**可见文本经
   64 字符窗分块协议，chunk 载荷不含任何 provider 字段；deferred 动作轮
   不产生可见文本（无文本即无分块），占位文案由产品层决定、不进 Worker。
4. checkpoint 只存 `messages + pending_calls + stream_id`；已读账本恢复时从
   消息历史重建，不复制进 checkpoint（契约 §6）。
5. 能力预检（ModelProfile ⊇ {text, tool_calling}）放在首次模型调用之前；
   真实模型兼容矩阵由发布门 live smoke 补齐。

## 结论

**继续使用 `pydantic-ai-slim==2.9.0`。** 六个验证问题全部可行，未发现阻断性
框架缺口；F1/F3 两个实测失败模式都有确定性的适配层解法（检测 + fail closed +
整流重建），不需要升级或更换框架。Worker 解析器（IK2D8L）与 Skill 驱动
Orchestrator（IK2D8O）可按上述适配层约束直接开工。
