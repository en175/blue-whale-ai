# Confirmation Gate Scenarios

测试确认门是否能阻止误推进。

## Scenario 1：用户说“继续”，但没有 ready node

输入：

```text
继续
```

前置状态：

```text
current_stage = image_generation
nodes = []
```

预期：

```text
不能 advance_stage
```

断言：

- `stage.status` 不变
- 不创建新的 `confirmed_at`
- `canvas_updates` 不包含 `confirmed` 状态

必须返回：

```text
我还没有看到当前阶段可确认的画布结果，不能直接进入下一步。我会先补齐当前阶段结果。
```

禁止：

- 推进到下一阶段
- 标记 confirmed

## Scenario 2：用户说“继续”，有 ready node

输入：

```text
继续
```

前置状态：

```text
current_stage = image_generation
node.status = ready
```

预期：

```text
二次确认，不直接推进
```

断言：

- `stage.status` 仍为 `awaiting_confirm`
- `node.status` 仍为 `ready`
- `turn_done.requires_user_action = true`

必须返回：

```text
我看到当前阶段已有结果。你是确认这版满意，进入下一步，还是还要修改？
```

禁止：

- 自动 advance_stage

## Scenario 3：用户明确确认，有 ready node

输入：

```text
确认，这版可以
```

前置状态：

```text
current_stage = image_generation
node.status = ready
```

预期：

```text
允许 confirm_stage
```

必须出现：

- node.status -> confirmed
- stage.status -> confirmed
- 进入下一 pending stage

断言：

- 当前 stage 有 `confirmed_at`
- 下一 stage 只创建为 `pending`,不能直接 `running`

## Scenario 4：用户要求修改

输入：

```text
保留构图，换成清晨桌面风格
```

前置状态：

```text
current_stage = image_generation
node.status = ready
```

预期：

```text
进入 revise_stage
```

必须出现：

- 原 node 不被覆盖
- 创建 revise task
- 保留用户明确要求保留的元素

断言：

- 原 node.status -> rejected 或保留 ready 但标记 superseded,不得删除原资产
- 新建 GenerationJob 带 revise instruction
- 新 canvas node 复用同一 stage_id 或明确绑定 revise stage_id

禁止：

- 自动确认
- 重跑整个 workflow

## Scenario 5：生成中不能确认

输入：

```text
确认
```

前置状态：

```text
node.status = generating
```

预期：

```text
不能确认
```

断言：

- `node.status` 仍为 `generating`
- `stage.status` 仍为 `running` 或 `awaiting_confirm`,不得变为 `confirmed`

必须返回：

```text
当前结果还在生成中，等画布结果完成后我再让你确认。
```
