import { describe, expect, it } from 'vitest';
import { DRAFT_NODE_SIZE, nextDraftPosition, overlaps, type SpawnBox } from './draftSpawn';


const noJitter = () => 0.5;
const SIZE = DRAFT_NODE_SIZE;

describe('nextDraftPosition', () => {
  it('无 Dock 无节点：返回视口中心（去抖后盒子居中）', () => {
    const pos = nextDraftPosition({
      center: { x: 1000, y: 500 },
      dockTop: Number.POSITIVE_INFINITY,
      nodes: [],
      random: noJitter,
    });
    expect(pos).toEqual({ x: 1000 - SIZE.width / 2, y: 500 - SIZE.height / 2 });
  });

  it('中心盒底越过 Dock 上沿：整体上移，盒底 ≤ dockTop - 24', () => {
    const pos = nextDraftPosition({
      center: { x: 1000, y: 500 },
      dockTop: 560,
      nodes: [],
      random: noJitter,
    });
    expect(pos.y + SIZE.height).toBeLessThanOrEqual(560 - 24);
  });

  it('中心被既有节点占据：另选不与任何节点相交的空位', () => {
    const blocker: SpawnBox = { x: 1000 - 160, y: 500 - 170, width: 320, height: 340 };
    const pos = nextDraftPosition({
      center: { x: 1000, y: 500 },
      dockTop: Number.POSITIVE_INFINITY,
      nodes: [blocker],
      random: noJitter,
    });
    const box: SpawnBox = { x: pos.x, y: pos.y, width: SIZE.width, height: SIZE.height };
    expect(overlaps(box, blocker)).toBe(false);
  });

  it('多个占位节点围堵：仍能找到空位且避开 Dock', () => {
    const nodes: SpawnBox[] = [
      { x: 840, y: 330, width: 320, height: 340 },
      { x: 1200, y: 330, width: 320, height: 340 },
      { x: 480, y: 330, width: 320, height: 340 },
    ];
    const pos = nextDraftPosition({
      center: { x: 1000, y: 500 },
      dockTop: 1300,
      nodes,
      random: noJitter,
    });
    const box: SpawnBox = { x: pos.x, y: pos.y, width: SIZE.width, height: SIZE.height };
    nodes.forEach((n) => expect(overlaps(box, n)).toBe(false));
    expect(pos.y + SIZE.height).toBeLessThanOrEqual(1300 - 24);
  });

  it('候选全部占满：回退到 Dock 避让后的中心位，不抛错', () => {
    const wall: SpawnBox = { x: -10000, y: -10000, width: 20000, height: 20000 };
    const pos = nextDraftPosition({
      center: { x: 1000, y: 500 },
      dockTop: 900,
      nodes: [wall],
      random: noJitter,
    });
    expect(pos.y + SIZE.height).toBeLessThanOrEqual(900 - 24);
  });

  it('返回整数坐标', () => {
    const pos = nextDraftPosition({
      center: { x: 333.7, y: 222.3 },
      dockTop: Number.POSITIVE_INFINITY,
      nodes: [],
      random: () => 0.25,
    });
    expect(Number.isInteger(pos.x)).toBe(true);
    expect(Number.isInteger(pos.y)).toBe(true);
  });
});
