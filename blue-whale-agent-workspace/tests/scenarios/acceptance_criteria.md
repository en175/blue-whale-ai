# Acceptance Criteria

这些验收标准用于测试 Blue-Whale Agent Workspace 的编排是否跑偏。

当前阶段是“文档级测试”，但每条场景都要写成后续可转接口断言的形式。

## 全局验收标准

### 1. 路由正确

Agent 必须先判断用户要的是：

- Direct Image
- Direct Video
- Image-to-Video
- Full Video Canvas
- Prompt-only

不能把所有视频请求都强制走完整广告链路。

### 2. 图片理解正确

上传图片不等于已经理解图片。

图生图、图片转视频、基于上传图做产品广告前，必须存在：

```text
asset_understanding
```

如果模型没有视觉能力，必须调用独立视觉模型或让用户补充描述。

### 3. 提示词优化在 Provider 前

Provider 调用前必须存在：

```text
optimized_prompt
```

不能直接把用户原话发给图片或视频生成模型。

### 4. 确认门有效

没有 ready 结果，不能确认。

用户只说“继续 / 好了 / 下一步”不能自动推进。

### 5. 用户可见思考过程合规

必须展示 `visible_reasoning`。

不得展示：

- prompt
- worker 文件名
- tool 参数
- JSON payload
- 本地文件路径
- trace_event
- 模型真实推理链

### 6. Skill 与模型语法不冲突

Skill 决定创意结构。

Seedance / 生图规则只决定生成提示词语法和稳定性。

优化层不能覆盖用户已确认的 Skill。

### 7. 产品切换 P0 可控

P0 只要求同一对话中维护两个产品方向：

- `active_product_context`
- `previous_product_context`

局部修改不能误判为换产品。

完全不同品类或目标时，只问用户是否继续在当前项目中进行，还是新建项目。

用户回到前一个产品或引用前一个产品重新生成时，必须使用历史产品素材和理解结果，但不能覆盖旧画布节点。

## 场景必须覆盖

| 场景 | 文件 |
|---|---|
| 生成链路路由 | `route_decision_scenarios.md` |
| 确认门 | `confirmation_gate_scenarios.md` |
| 图片理解 / 多模态 | `multimodal_scenarios.md` |
| 提示词优化 | `prompt_optimization_scenarios.md` |
| 产品切换 P0 | `product_switch_p0_scenarios.md` |

## 通过标准

一轮测试通过，需要满足：

1. 每个场景选择了正确 workflow。
2. 必须出现的 ChatMessage / GenerationJob / canvas node 全部出现。
3. 禁止出现的消息、节点或阶段跳转没有出现。
4. 用户可见输出没有泄露内部信息。
5. 需要确认的阶段没有被跳过。
6. canvas node 的 `type` 只能是 `image` / `video`;生成任务用 GenerationJob 断言,不能伪装成 `image_task` / `video_task` 节点。
