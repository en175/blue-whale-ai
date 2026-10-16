# IKLUVP 人工回归页面

打开 http://127.0.0.1:3016/manual/ikluvp/index.html，按左侧 8 组顺序操作，记录通过、不通过或受阻，最后导出报告并把摘要发回聊天。

页面首次生成一段 6 秒参考视频。视频只送到本机 Vite 的内存服务，不进入素材库或任何远程服务。无需登录或上传用户素材。建议用 Chrome 或 Edge。

## 运行

在本任务工作树的 web 目录执行：

```sh
npm run dev:test -- --config manual/ikluvp/vite.config.ts --port 3016 --strictPort --host 127.0.0.1
```

只启动 Vite。配置不继承测试站代理；未准备的 API 明确返回 404，不转发到外部。页面 CSP 限定请求与媒体来源。

## 真实部分与模拟部分

产品提交为 f74850fd0a968f0581726df5f03c2e22a771dc9f。

- 使用真实 BottomDialog、ChatBox、ModelFormModal 和 useCanvasUpdateGenerate。
- 本地 HTTP 请求调用真实 handleCreateGenerationJob、parseModelUpdateBody 与 toFeatures。
- 项目和素材读取使用固定数据。任务创建写入内存桩并展示收到的完整快照，不启动 worker，不调用供应商，不计费。
- 草稿由测试宿主保存在本机 localStorage，用于检查组件重开、刷新和重新生成。它不能证明真实 Canvas 保存接口或数据库的持久化行为。
- 首页参数交接使用真实 setGenHandoff/takeGenHandoff，但目标路由使用 MemoryRouter，不进入真实项目。
- 报告由人选择结论，记录操作证据；没有自动提交工单或自动验收。

## 范围

C1 自动延长，C2 指定秒数，C3 草稿恢复与重新生成，C4 编辑锁定，C5 模型隔离，H1 首页交接，A1 管理端三种配置，B1 边界拒绝。

已验证的本地接口包括 -1、4、10、30 秒放行，3、31、0、-2、4.5 秒拒绝，错误比例、编辑固定秒数、未开放自动的模型拒绝，三种配置往返以及未支持模式的写侧拒绝。

未执行：真实测试站部署、真实 Canvas 数据库保存、任务入队、worker 上游生成与计费。此前两项参考上限键族测试失败源于旧标签表路径。本轮已校正测试来源，保留原有断言；工程验证以最终提交的验证凭证为准。

## 页面预检

```sh
npx tsc --project manual/ikluvp/tsconfig.json --noEmit
npm test -- manual/ikluvp/runtime.test.tsx manual/ikluvp/flows.test.tsx manual/ikluvp/guide.test.tsx
npx vite build --mode test --config manual/ikluvp/vite.config.ts
```

测试使用 jsdom，不使用浏览器自动化。浏览器视觉与最终操作结论由人工填写。
