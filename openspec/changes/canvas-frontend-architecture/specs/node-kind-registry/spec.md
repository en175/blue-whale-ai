## ADDED Requirements

### Requirement: 五种 NodeKind 全注册

`nodeKinds` SHALL 包含 `text`/`image`/`video`/`audio`/`group` 五个 key。每个 spec SHALL 含 `media`、`inputs`、`outputs`、`buildTask`、`Component`。

#### Scenario: registry 覆盖五种 kind

- **WHEN** 读取 `Object.keys(nodeKinds)`
- **THEN** 结果为 `["text","image","video","audio","group"]`，且每项含 `media`/`inputs`/`outputs`/`buildTask`/`Component`

### Requirement: group 占位不可直接 buildTask

`group` 的 `media` SHALL 为 `null`，`buildTask` SHALL throw（group 必须经 runGroup 运行，不直接构造任务）。

#### Scenario: group buildTask 抛错

- **WHEN** 调用 `nodeKinds.group.buildTask(anyNode, {})`
- **THEN** 抛出错误，错误信息含 "runGroup"

### Requirement: buildTask 引用优先于节点自带

`buildTask` SHALL 优先采用 `inputs`（来自引用 link）的值；当某输入端口无引用时，SHALL fallback 到 `node.data` 自带字段（如 `prompt`）。

#### Scenario: 有引用输入则用引用

- **WHEN** 对一个自带 `data.prompt="自带的"` 的 image 节点调用 `buildTask(node, { prompt: textAssetRef })`
- **THEN** 产出的 TaskInput.prompt 等于引用的 text 内容，而非 `"自带的"`

#### Scenario: 无引用则 fallback 自带

- **WHEN** 对同一节点调用 `buildTask(node, {})`（无 prompt 引用）
- **THEN** 产出的 TaskInput.prompt === `"自带的"`
