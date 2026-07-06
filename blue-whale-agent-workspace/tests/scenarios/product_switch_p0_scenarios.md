# Product Switch P0 Scenarios

这些场景用于验证 P0 阶段的产品切换规则是否可控。

P0 只支持同一对话中维护两个产品方向：

- 当前产品：`active_product_context`
- 前一个产品：`previous_product_context`

不要求 P0 实现完整历史版本索引、长期摘要或多版本恢复。

## 场景 1：同一产品的局部修改

### 输入

用户已经上传保温杯产品图，并完成图片理解。

用户说：

```text
把背景换成办公室桌面，产品不变。
```

### 预期

- 不切换 `active_product_context`。
- 不创建新的产品方向。
- 进入 revise / prompt update。
- 继续使用当前产品的 `asset_understanding`。
- 如需生成，创建新的 GenerationJob 和新的 image / video canvas node。

### 禁止

- 询问是否新建项目。
- 把局部修改误判为换产品。

## 场景 2：同一项目内切换产品

### 输入

当前产品是保温杯。

用户说：

```text
我们换成咖啡机来做一版。
```

### 预期

- 将保温杯保存为 `previous_product_context`。
- 为咖啡机建立新的 `active_product_context`。
- 重新确认 Brief / Skill / stage plan。
- 旧的保温杯画布内容默认保留，不删除。

### 禁止

- 直接沿用保温杯的 Skill 和产品理解。
- 对用户说“替换”“覆盖”“workflow”“stage”“superseded”。

## 场景 3：完全不同品类或目标

### 输入

当前产品是保温杯广告。

用户说：

```text
现在我想做一个健身课程的招生视频。
```

### 预期

Agent 必须只问：

```text
这是一个新的产品方向。你想继续在当前项目中进行，还是新建一个项目？
```

如果用户选择继续在当前项目中进行：

- 将保温杯保存为 `previous_product_context`。
- 将健身课程设为新的 `active_product_context`。
- 重新确认 Brief / Skill / stage plan。

如果用户选择新建项目：

- 返回创建新项目所需的前端动作或后端 intent。
- 不在当前项目里继续生成。

### 禁止

- 询问用户选择哪个 workflow。
- 使用“替换当前项目内容”这类容易误解的表达。

## 场景 4：回到前一个产品

### 输入

当前产品是咖啡机，前一个产品是保温杯。

用户说：

```text
还是回到前面的保温杯。
```

### 预期

- 将 `previous_product_context` 切回 `active_product_context`。
- 将咖啡机保存为新的 `previous_product_context`。
- 不自动生成新内容。
- 简短确认当前已回到保温杯方向。

### 禁止

- 让用户重新上传保温杯素材。
- 自动删除咖啡机内容。

## 场景 5：用前一个产品重新生成

### 输入

当前产品是咖啡机，前一个产品是保温杯。

用户说：

```text
用前面的保温杯重新生成一张产品图。
```

### 预期

- 读取 `previous_product_context` 的产品素材和 `asset_understanding`。
- 将保温杯切回当前产品方向。
- 创建新的 GenerationJob。
- 创建新的 image canvas node。
- 旧的保温杯结果和咖啡机结果都不覆盖。

### 禁止

- 使用当前咖啡机素材生成。
- 覆盖旧画布节点。

