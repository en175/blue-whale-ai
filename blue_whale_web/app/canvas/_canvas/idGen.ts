/**
 * idGen —— 消息 ID 生成器
 *
 * 解决 `Date.now()` 在同一同步执行栈内连续调用必然碰撞的问题：Agent 模式
 * 一次回复在单 tick 内连续生成 thinking / agent / card 三条消息，三次
 * `Date.now()` 时间差几乎必然 < 1ms → 三条消息必然同 ID → React 重复 key 警告。
 *
 * 用单调递增计数器：基数取当前时间戳（保证比现存 `Date.now()` 派生的历史
 * 消息 ID 更大、不回退冲突），之后每次调用自增，组件生命周期内全局唯一。
 * 用户消息与 mock 回复共用同一生成器实例，从根上消除碰撞。
 */
export type MessageIdGenerator = () => number;

/** 创建消息 ID 生成器（基数取挂载时间戳，后续单调自增）。 */
export function createMessageIdGenerator(): MessageIdGenerator {
  let seq = Date.now();
  return () => seq++;
}
