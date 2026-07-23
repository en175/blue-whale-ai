## ADDED Requirements

### Requirement: resolveInputs 只读不级联

`resolveInputs(target, nodes, edges)` SHALL 只读取上游节点当前 `assetId` 对应的 Asset 作为输入，MUST NOT 触发任何上游节点的运行。

#### Scenario: 读上游当前值不触发上游

- **WHEN** 对一个有上游 link 的 target 调用 `resolveInputs`
- **THEN** 返回 `{ [targetHandle]: upstreamAsset }`，且整个调用不产生任何副作用、不调用 generate

### Requirement: topoSort 环检测

`topoSort(ids, edges)` SHALL 返回一个合法拓扑序（每个节点排在其所有上游之后）；当 ids 内存在环时 SHALL 返回 `null`。

#### Scenario: 有环返回 null

- **WHEN** edges 在 ids 内形成 A→B→A 的环
- **THEN** `topoSort(ids, edges)` 返回 `null`

#### Scenario: 无环返回合法序

- **WHEN** edges 为 A→B→C（无环）
- **THEN** 返回的序中 A 在 B 前、B 在 C 前

### Requirement: runNode 单跑绝不级联

`runNode(nodeId, ctx)` SHALL 只对目标节点提交一次 generate，MUST NOT 递归运行其上游；上游的当前值作为输入快照读取。

#### Scenario: 单跑有引用的节点不触发上游

- **WHEN** `runNode(nodeId)` 且 nodeId 有上游 link
- **THEN** `ctx.generate` 恰好被调用一次（针对 nodeId），上游节点的 run/generate 未被调用

### Requirement: group 经 runGroup 拓扑级联

对 group 节点调用 run SHALL 转 `runGroup`：成员按内部 link 拓扑顺序逐个运行，使下游成员读到上游刚产出的值（级联）。

#### Scenario: runGroup 按拓扑顺序级联

- **WHEN** 一个 group 含成员 A→B（A 的输出是 B 的输入），调用 `runGroup(groupId)`
- **THEN** A 先 run 完成并回填 value 后，B 才开始 run，且 B 的 inputs 含 A 的新值
