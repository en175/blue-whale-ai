# 弃用 web-doc 文档站，统一到 api-docs（fumadocs）

早期用 Docusaurus + `docusaurus-plugin-openapi-docs` 搭了 `web/web-doc`，从 `openapi/relay.json`（35 个 AI 模型接口，new-api 源副本）自动渲染接口文档。后搬入 fumadocs 文档站 `web/api-docs`（手写 MDX + fumadocs-openapi，spec 源 `NewAPI.apifox.json`，覆盖 43 个 ai-model 接口 + management，三语 zh/en/ja，已品牌化为 Blue Whale，见 PR !133）。

api-docs 是 web-doc 的超集且 spec 独立（不读 `relay.json`），故删除整个 `web/web-doc`（含 `openapi/relay.json`），接口文档站统一到 api-docs。web-doc 不在生产部署（Dockerfile/compose 不 build）、全仓无外部引用，删除无运行时影响。

## Considered Options

- **保留 web-doc 归档**：两套文档站并存易混淆、增维护负担，否决。
- **删代码、留 `relay.json`**：api-docs 不依赖 `relay.json`（用 `NewAPI.apifox.json`），留之无用，否决。

## Consequences

- `relay.json`（35 接口 new-api 源 spec）随 web-doc 删除；将来若需 new-api 源 spec 对照，从 git 历史或 new-api 上游取。
- 接口文档站唯一入口：`web/api-docs`（fumadocs，端口 3011）。
