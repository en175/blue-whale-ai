// Vitest 全局 setup：集中注册 @testing-library/jest-dom matchers，
// 让 `toBeInTheDocument` / `toHaveAttribute` 等自定义断言在所有 *.test.tsx 可见。
// 之前各测试文件自己 `expect.extend(jestDomMatchers)`，现在统一到这里。
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(jestDomMatchers);
afterEach(() => {
  cleanup();
});