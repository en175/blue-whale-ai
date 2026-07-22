import { describe, it, expect, vi, afterEach } from "vitest";
import { toast, type ToastListener } from "./toast";

describe("toast store", () => {
  afterEach(() => {
    vi.useRealTimers();
    toast.__reset();
  });

  it("toast.error 推送到订阅者，约 4s 后自动消失", async () => {
    vi.useFakeTimers();
    const snapshots: string[][] = [];
    toast.subscribe((items: readonly { message: string }[]) =>
      snapshots.push(items.map((t) => t.message)),
    );

    toast.error("上传失败");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(["上传失败"]);

    vi.advanceTimersByTime(4000);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toEqual([]);
  });

  it("toast.success 推送到订阅者", () => {
    vi.useFakeTimers();
    const snapshots: string[][] = [];
    toast.subscribe((items) => snapshots.push(items.map((t) => t.message)));

    toast.success("操作成功");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(["操作成功"]);
  });

  it("多条 toast 同时显示，各自独立消失", () => {
    vi.useFakeTimers();
    const snapshots: string[][] = [];
    toast.subscribe((items) => snapshots.push(items.map((t) => t.message)));

    toast.error("A");
    toast.success("B");

    expect(snapshots.at(-1)).toEqual(["A", "B"]);

    vi.advanceTimersByTime(4000);
    expect(snapshots.at(-1)).toEqual([]);
  });

  it("toast.dismiss 手动消除单条", () => {
    vi.useFakeTimers();
    const snapshots: { id: string; message: string }[][] = [];
    toast.subscribe((items) =>
      snapshots.push(items.map((t) => ({ id: t.id, message: t.message }))),
    );

    toast.error("err");
    const [item] = snapshots[0];
    toast.dismiss(item.id);

    expect(snapshots.at(-1)).toEqual([]);
  });

  it("取消订阅后不再收到通知", () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const unsub = toast.subscribe(() => calls.push(1));

    toast.error("x");
    expect(calls).toHaveLength(1);

    unsub();
    toast.error("y");
    expect(calls).toHaveLength(1);
  });
});
