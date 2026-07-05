## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## 设计系统 (DESIGN.md)

前端设计系统契约在 `blue_whale_web/DESIGN.md`（`@google/design.md` 格式）。它由两部分组成：YAML front matter 的设计 token（机器可读）+ Markdown 正文的设计理念（人/agent 可读）。

规则:
- 修改 `blue_whale_web/` 下任何 UI（颜色、字体、圆角、间距、组件样式）前，**必须先读 `blue_whale_web/DESIGN.md`**。
- 颜色/字体/圆角/间距一律使用其中定义的 token，**禁止在组件里硬编码 hex/rgba 值**；新增颜色先在 `colors:` 注册，再用 `{colors.xxx}` 在组件里引用。
- 强调色只用 `accent`；状态色只用 `success` / `destructive`；不引入第二个品牌强调色。
- 改完 DESIGN.md 后在 `blue_whale_web/` 运行 `npm run design:lint` 校验（0 errors 才算通过，warnings 可接受）；导出 Tailwind 主题用 `npm run design:export:tw`。
- `npm run design:spec` 依赖补丁 `blue_whale_web/patches/@google+design.md+0.3.0.patch`（npm 包 0.3.0 缺 `dist/spec.md`，由 `postinstall` 跑 `patch-package` 自动补回）。**升级 `@google/design.md` 版本后必须重做补丁**：先 `npm i @google/design.md@latest`，再按需重新下载 spec.md 到 dist/ 并 `npx patch-package @google/design.md`。
