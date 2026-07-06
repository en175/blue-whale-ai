# Confirmation Gate Rule

确认门是 Blue-Whale Agent Canvas 的硬规则。

## 一句话规则

没有画布 ready 结果，就不能确认；用户没有明确确认，就不能推进。

## 确认门触发点

Full Canvas 的 stage 分两类：**硬停**（必须用户明确确认才推进，= turn 边界）和**软过**（Agent turn 内自动推进，用户可随时打断）。

**硬停（4 个，= turn 边界）：**

- Brief 摘要完成
- 脚本分镜完成
- 首批视觉 ready
- 视频结果 ready

**软过（3 个，turn 内自动推进）：**

- Skill 推荐（Skill Selector 出推荐 + 理由，用户不改则默认走；想改随时说）
- 阶段计划（Director 出 stage plan，meta 信息，用户大多不关心）
- 最终审核（Review 出交付摘要，不构成阻断）

> 轻量编排链路（简单图/视频）只有 1 个硬停：优化提示词（`optimized_prompt_preview`）用户确认才生成。详见 `AGENT-CONVERSATION-PRD.md`。

> 一个 Agent turn 内可跨「软过 stage」推多条 message；遇「硬停 stage」必须 `turn_done` 停下等用户确认。

## 用户表达分类

### 明确确认

可以推进：

- 确认
- 满意
- 通过
- 这版可以
- 就这个
- OK
- 可以进入下一步

前提：当前阶段必须有 ready 结果。

### 弱继续

不能直接推进，需要二次确认：

- 继续
- 好了
- 下一步
- 好的
- 行

标准回复：

```text
我看到当前阶段已有结果。你是确认这版满意，进入下一步，还是还要修改？
```

### 修改意图

不能推进，进入 revise：

- 改一下
- 重做
- 不满意
- 换风格
- 这个不对
- 保留 A，重做 B

### 等待中

如果 canvas 节点还是 generating：

```text
当前结果还在生成中，等画布结果完成后我再让你确认。
```

### 没有结果

如果 canvas 没有当前阶段结果：

```text
我还没有看到当前阶段可确认的画布结果，不能直接进入下一步。我会先补齐当前阶段结果。
```

## 后端实现含义

确认门不是模型建议，而是状态约束。

必须检查：

- 当前 workflow stage
- 当前 canvas node 是否属于该 stage
- node status 是否为 `ready`
- 用户表达是否为明确确认

只有全部满足，才允许 `advance_stage`。

## 禁止

- 禁止模型自己说“我默认你确认了”。
- 禁止用户只说“继续”就推进。
- 禁止没有 ready node 时推进。
- 禁止生成中结果被当成完成结果。
