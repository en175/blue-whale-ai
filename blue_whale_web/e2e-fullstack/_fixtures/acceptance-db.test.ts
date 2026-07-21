/**
 * acceptance-db 单元测试（IK2BDN T6.3）
 *
 * parseTsv 是全栈验收读取 MySQL batch 输出（-N -B）的唯一解析点，
 * 行/列/空值解析错误会让治理事实断言静默失真，故单测钉死。
 */
import { describe, expect, it } from "vitest";
import { parseTsv } from "./acceptance-db";

describe("parseTsv", () => {
  it("解析多行多列的 batch 输出", () => {
    expect(parseTsv("decided\tpass\ndecided\tpass\n")).toEqual([
      ["decided", "pass"],
      ["decided", "pass"],
    ]);
  });

  it("空输出返回空数组", () => {
    expect(parseTsv("")).toEqual([]);
  });

  it("忽略末尾换行与空行", () => {
    expect(parseTsv("1\n\n2\n")).toEqual([["1"], ["2"]]);
  });

  it("单列标量输出", () => {
    expect(parseTsv("4\n")).toEqual([["4"]]);
  });

  it("保留列内空字符串与空白", () => {
    expect(parseTsv("a\t\tc\n")).toEqual([["a", "", "c"]]);
  });
});
