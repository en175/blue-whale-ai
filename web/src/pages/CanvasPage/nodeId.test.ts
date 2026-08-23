import { describe, expect, it } from 'vitest';
import { newNodeId } from './nodeId';

describe('newNodeId', () => {
  it('同一毫秒里连续建多个节点也不撞——「整组应用」正是这个形状（审查 W·A17）', () => {
    // 生产里是 `cards.forEach((card) => handleCardApply(card, {}))`：一组 4 张分镜卡
    // 在同一个事件循环里建 4 个节点。旧写法 `gencard-${Date.now()}` 会给出 4 个相同 id，
    // 删一个把四个全过滤掉、编辑一个改写四个。
    const ids = Array.from({ length: 200 }, () => newNodeId('gencard'));
    expect(new Set(ids).size).toBe(200);
  });

  it('保留前缀，便于在画布文档里认出节点类型', () => {
    expect(newNodeId('text')).toMatch(/^text-\d+-\d+$/);
  });

  it('不同前缀之间也不会互相碰撞', () => {
    const ids = [newNodeId('text'), newNodeId('media'), newNodeId('text')];
    expect(new Set(ids).size).toBe(3);
  });
});
