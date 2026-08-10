import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "out"],
    setupFiles: ["./vitest.setup.ts"],
    // 多个 jsdom 环境（`@vitest-environment jsdom` 逐文件声明）在同一 worker 线程里
    // 堆叠到一定数量后，后建的 Window 会拿到坏的 localStorage（缺 .clear 等方法），
    // 报 "localStorage.clear is not a function"，且随测试文件总数变化而或触发或不
    // 触发。单线程跑各文件互不共享 worker，规避该问题；已验证可行。
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
