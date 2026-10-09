# 受保护项判据锚定节点持有者表，不再以画布文档里的标记为准

**状态**：accepted（2026-10-09，IKKBL9）

规则一句话：**「谁算受保护项」由 `generation_canvas_node_owners`（该节点现在归谁）回答；画布文档里的 `generationRecovery` 标记只是上次保存时的事实快照，过期即不构成保护依据。**

这条不是废止受保护项机制，是给它换锚。机制要守的不变量不变：**服务端事实对应的节点不得被无声改动**——这是画布 `version` 给不了的（乐观锁只管并发覆盖，不管「文档说的和服务端记的不是一回事」）。

## 动因

1. **文档标记会过期，归属表不会。** 提交受理时 `writeCanvasRecoveryRows` 会把节点的归属行改指新提交，并把上一个承接者的 `target_state` 置为 `transferred`（`backend/libs/shared/persistence/generation-canvas-recovery-repo.ts:214`）。但画布文档里的标记只在**客户端自己**做恢复动作时才更新；别人在另一台设备发起生成、或服务端受理新提交，客户端收不到信号，文档里的标记会一直停在旧值。
2. **判据看文档就必然误拒。** 改动前的守护循环遍历**旧文档里带标记的节点**，未在本次 `recoveryChanges` 里声明的就要求来件标记与旧标记**逐字一致**（`backend/libs/shared/persistence/canvas-recovery-save.ts` 原 552–567 行）。它不查归属表、也不区分提交状态。于是一条早已 `transferred`（交棒完成）的旧提交仍被当作「必须显式声明才能改」的受保护项。
3. **生产上已经拒过。** 2026-10-09 测试站项目 `1330`、节点 `media-draft-1791508109729-12`、`canvas.version = 280`：文档标记停在第 28 号提交（已 `transferred`），归属表指第 34 号（`pending`），客户端把标记同步到第 34 号——**这是正确行为，归属表也这么认为**——却必然 422 `未声明的受保护项被改动，须以显式恢复动作变更`。版本号一致，所以不是并发冲突；客户端要过关只能为一条早已交棒的旧提交补一条无业务意义的动作。
4. **「按提交状态过滤」盖不住多输出。** 全仓唯一写 `transferred` 的地方是 `generation-canvas-recovery-repo.ts:214`，写的是 `generation_canvas_submissions.target_state`；`generation_canvas_outputs.state` 尽管 schema 注释里列了 `transferred`，**没有任何代码路径会写成它**。所以「把 `transferred` / `replaced` 的旧项排除出受保护范围」只对 `$target` / `primary` 这条单结果路径有效，对 `slot:` / `segment:` / `track:` 完全无效。
5. **节点归属天然是每节点一行。** `generation_canvas_node_owners` 的唯一键是 `(project_id, node_id)`，删除保留归属行与版本；`slot:` 的节点 id 是 `generation-output:<slotId>`、**不含 submissionId**，两次提交往同一逻辑槽位产出会落到同一节点——多输出里唯一真会出现「旧标记陈旧」的形态（`segment:` / `track:` 的节点 id 含 submissionId，按提交分片，不存在跨提交接管）。

## Considered Options

- **甲·只放宽（采纳）。** 判据仍按旧文档里的标记迭代，但来件标记只要**等于旧标记**或**等于该节点当前持有者**就放行；陈旧节点缺席时改看**持有者那条**有没有被声明。
- **乙·跳过陈旧项。** 旧标记不是该节点持有者时整节点不校验。写法最短，但该节点在**这一次保存里完全失去守护**——客户端可以把标记剥掉、把资产换掉、把内容换成任意值，下一次保存才重新被保护。否决。
- **丙·整体换轴。** 不再给旧标记豁免权，来件必须携带持有者的标记，除非显式声明。概念最干净，但**会收紧**：今天「客户端原样把旧标记带回来」是能存过的（文档确实落后，但没人在改这个节点），丙之后变 422——那会把**与这个节点无关的编辑也一起冻住**。动因 1 已经说明文档落后是常态而非异常。否决。
- **沿用文档标记，只额外查提交状态。** 见动因 4，盖不住多输出路径，而验收明确要求覆盖它。否决。

选甲的直接理由：**它只放宽不收紧**——今天能存过的明天还照样存过，不产生任何新的 422，同时修掉报告里的误拒和一个尚未爆发的死锁（陈旧节点的旧标记是 `transferred`，客户端对它发 `remove` 会 409，只有改声明持有者的键才有活路）。

## Decisions

1. **「陈旧」= 该节点有归属行，且归属行指的 (提交, 产物键) 不是旧标记那一对。** 查不到归属行**不算陈旧**，照旧守护——归属表没话说的时候，不主动假定文档在说谎。这一条很关键：`canvas-recovery-save.ts` 只在 `outputRowId === null` 时为多输出项建归属行，所以「有标记、无归属行」在已落库的多输出项上是**正常路径**；把它当陈旧会当场丢掉守护。
2. **陈旧节点上的来件标记可推进到持有者。** 放行时**同时跳过** `protectedCardKept` 的资产/类型比较——卡片合法地换成了新结果。来件既不是旧标记也不是持有者，照旧拒绝。
3. **陈旧节点的缺席改锚持有者。** 节点从文档里消失且旧标记陈旧时，要求**持有者那条**在本次 `recoveryChanges` 里被声明，而不是要求旧标记那条。旧标记那条多半是 `transferred`，对它声明 `remove` 会 409，是一条走不通的死路。
4. **旧协议守卫同修，但缺席保持严格。** `guardLegacyCanvasWrite` 加第三个参数——一个「当前持有者键集合」（键形如 `nodeId:submissionId:outputKey`），保持纯函数、无 DB 依赖，调用点按需注入（项目没有恢复提交时传空集，不额外查库）。它的**缺席分支不放宽**：旧协议路径没有声明机制，客户端改不动受保护节点时本来就会走恢复协议路径。
5. **归属行不会被「陈旧」判定弱化为可删除。** 归属行在删除时保留（schema 注释「删除保留归属行和版本」），所以陈旧只是「文档标记不再是保护依据」，不等于「这个节点没人管」。

## Consequences

- **画布文档里的标记降级为提示位。** 服务端权威在归属表；文档标记只用于渲染与增量校验。长期来看客户端该在收到归属变化时刷新标记（本单未立前端票，漂移现象与观测口径记在 IKKBL9 工单评论里）。
- **判据多一次查询。** 恢复保存路径在守护前要多取一次「上一版文档里带标记的节点」的归属行，并把这批节点的 `generation_canvas_submission_id` 翻成 `submission_id`（marker 带 UUID、归属行带自增 id）。归属行查询的锁范围从「本次声明涉及的节点」扩到「声明涉及的节点 ∪ 上一版带标记的节点」，都在同一事务同一项目内。
- **新增门控套件** `backend/libs/shared/persistence/ikkbl9-canvas-recovery.integration.test.ts`（`IKKBL9_DATABASE_URL` / `bw_gate_ikkbl9`，runbook `docs/verification/ikjrh0-integration-test-runbook.md` 已补行）。四条：目标节点接管的陈旧推进、陈旧缺席的守护与改锚、slot 节点接管的陈旧推进、来件既非旧标记也非持有者的拒绝。前三条已用「临时关掉对应判据 → 必须变红」验证过它们钉得住修复。
- **`segment:` / `track:` 不造夹具，改为可执行断言。** 断言写在 `backend/libs/shared/persistence/canvas-recovery-multi-output.test.ts`：这两类节点 id 含 `submissionId`，跨提交接管不会发生，故不存在陈旧标记形态。将来有人改节点 id 派生方式会立刻红。
- **`canvas.service.test.ts` 的 prisma 桩需补 `generation_canvas_node_owners`。** 旧协议路径新增了一次归属行查询，桩缺这张表会 `TypeError`。
- **`ikjjqz-mix-mux-canvas-recovery` 在本批次 tip 上本来就是红的**（8/11），与本次改动无关：桩掉本次全部源码改动后单独跑，失败集合逐条相同。
