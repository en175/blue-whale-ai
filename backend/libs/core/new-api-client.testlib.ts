// IK74V8：new-api 客户端用例的共享夹具（从 new-api-client.test.ts 拆出）。
// 命名 *.testlib.ts：tsconfig 排除编译、vitest 不当作用例文件收集。

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
