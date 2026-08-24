/**
 * 画布节点 id 生成器。
 *
 * 此前各处写的是 `` `gencard-${Date.now()}` ``。毫秒时间戳在**同一个事件循环里连续建多个节点**
 * 时会撞：「整组应用」是一个同步的 `cards.forEach(...)`，一组 4 张分镜卡产出 4 个共享同一个 id
 * 的节点（审查 W·A17）。而 `spawnPosition()` 是随机的，所以它们看上去各就各位——
 * 删一个会把四个全过滤掉、编辑一个会改写四个，冲突要到用户去操作时才暴露。
 *
 * 计数器解决的正是"同一毫秒内多次调用"这一种碰撞；时间戳前缀保留，便于在画布文档里
 * 一眼看出节点是什么时候建的。**不用 `crypto.randomUUID()`**：这些 id 会随画布文档
 * 持久化，短一点、可读一点更有用，而这里也不需要跨端唯一。
 */
let seq = 0;

export function newNodeId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}
