# Worker Authoring Standard

本文件定义 `skill/workers/*.md` 的编写标准。

目标：每个 worker 都应该像一个可被 CEO 调度的独立角色，而不是普通说明文档。

## 标准结构

每个 worker 必须尽量包含以下章节。

```text
# Worker Name

> 运行方式

## 角色
## 任务边界
## 输入
## 模式
## 执行流程
## 输出契约
## visible_reasoning
## 质量自检
## 缺信息 / 失败处理
## 绝对禁止
```

## 章节说明

### 角色

定义这个 worker 是谁，擅长什么。

好的写法：

```text
你是视频画布的主控导演，负责路由、状态判断和确认门，不负责写脚本或生成提示词。
```

差的写法：

```text
负责路由。
```

### 任务边界

明确负责什么、不负责什么，避免 worker 越权。

### 输入

列出 CEO 会传入的信息，包括：

- 用户最新消息
- canvas 状态
- workflow 状态
- selected skill
- asset_understanding
- prompt draft

### 模式

同一个 worker 可能有多个模式。

例如 Image Prompt Agent：

- text-to-image
- image-to-image
- product image
- storyboard frame
- style reference

### 执行流程

用 Step 1 / Step 2 / Step 3 写清楚。

每一步都要说明：

- 做什么判断
- 产出什么
- 什么时候停

### 输出契约

必须定义返回结构。

输出至少区分：

- 给用户看的内容
- 给后续 Agent 用的内容
- 给后端保存的状态

### visible_reasoning

必须给出用户可见思考过程示例。

注意：这是产品化摘要，不是真实推理链。

### 质量自检

输出前必须检查：

- 是否越权
- 是否缺信息
- 是否违反确认门
- 是否暴露内部信息
- 是否改变已确认内容

### 缺信息 / 失败处理

说明什么时候追问，什么时候默认补全，什么时候停止。

### 绝对禁止

列出不可违反的硬规则。

## 编写原则

1. Worker 是可执行角色，不是知识笔记。
2. Worker 只做自己的阶段，不替其他 worker 决策。
3. 复杂细节放 references，worker 只放执行需要的核心规则。
4. 输出必须能被后端和前端消费。
5. 用户可见内容必须过滤内部实现细节。

## 验收标准

一个合格 worker 应该回答清楚：

- 谁调用它？
- 它什么时候启动？
- 它输入什么？
- 它输出什么？
- 它什么时候停？
- 它不能做什么？
- 它如何处理缺信息？
- 它如何把结果交给下一个 Agent？
