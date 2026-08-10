# BLUE WHALE API 官网与文档站实施计划

- **日期**：2026-08-10
- **状态**：待确认实施拓扑后执行
- **设计依据**：[官网与文档站设计](2026-08-10-bluewhale-api-website-design.md)
- **实际应用仓**：\`E:\\IDEA_Programme\\new\\blue-whale-api\`

## 1. 先决决策：品牌保护边界

目标仓的 \`AGENTS.md\` 明确禁止修改、删除、替换或移除任何 \`new-api\` / \`QuantumNous\` 相关的品牌、归属、元数据和引用。该规则与 PRD 所要求的“把既有通用网关官网改为 BLUE WHALE API 官网”冲突。

因此，本计划采用下列可执行且合规的路径：

1. 在目标仓新建隔离应用 \`web/bluewhale-portal/\`，作为新的 BLUE WHALE API 官网和公开文档站；
2. 它独立构建、独立部署到 BLUE WHALE 的正式域名，并由该域名提供 \`/\` 与 \`/docs\`；
3. 不修改 \`web/default/\`、\`web/api-docs/\`，也不修改任何既有 \`new-api\` / \`QuantumNous\` 信息；
4. 如需把旧站首页替换成 BLUE WHALE API，必须先由项目负责人书面变更该保护规则；本计划不包含该操作。

实施前由需求方确认以下两项：

- 允许在 \`E:\\IDEA_Programme\\new\\blue-whale-api\` 的 task worktree 新增 \`web/bluewhale-portal/\`；
- BLUE WHALE 正式域名、控制台入口、SDK 入口和已批准的公开 API 契约已交付给实现人员。

若第一项不获批准，应把同一目录结构放入一个新建的独立仓库，而不是改造受保护的现有前端。

## 2. 成功标准与非目标

完成后的 BLUE WHALE 域名必须交付中文优先的官网和公开文档站。访客可从官网进入文档或既有控制台，并能在文档中理解“提交异步任务 → 获得 \`task_id\` → 轮询或 Webhook → 下载结果”的完整接入路径。

公开内容只允许来自已批准的公开视频 API 契约：

- 唯一对外模型：\`seedance-2.0\`；
- 已批准的视频生成能力、参数、状态、错误、限流、Webhook 与结果下载规则；
- 已确认的控制台、Python SDK、JavaScript SDK 和商务合作入口。

下列内容不得进入门户源码、静态产物、SEO 元数据、站点地图、搜索索引或可访问路由：通用 AI 网关定位、其他模型、Chat、Completions、Embeddings、Images、独立 Audio API、Realtime、Management API、价格、充值、免费额度、余额、内部渠道信息、上游签名 URL 或密钥。文档仅可保留“费用以官方公告为准”的中性说明。

本计划不重新实现注册、登录、控制台、API Key 生命周期、SDK、计费或网关业务逻辑。若网关尚未具备幂等提交、Webhook 签名和安全结果 URL 所需语义，门户不得用文案假定它们已存在。

## 3. 目标目录与职责

\`\`\`text
E:\\IDEA_Programme\\new\\blue-whale-api\\web\\bluewhale-portal\\
├── contract\\
│   └── public-video-api.openapi.yaml       # 已批准的公开契约，唯一事实来源
├── content\\docs\\zh\\                       # 中文公开文档，不放管理或其他模型内容
├── playwright.config.ts                     # 端到端与视觉回归配置
├── scripts\\
│   ├── validate-public-contract.ts          # 契约白名单校验
│   └── check-public-surface.ts              # 内容、路由和构建产物红线扫描
├── source.config.ts                          # Fumadocs 内容源，仅指向本门户内容
├── src\\
│   ├── app\\page.tsx                         # 根路径重定向到中文首页
│   ├── app\\[lang]\\(marketing)\\            # 官网页面
│   ├── app\\[lang]\\docs\\                   # 文档页面
│   ├── components\\marketing\\               # 官网区块
│   ├── lib\\public-contract.ts               # 契约读取、类型和展示数据
│   ├── lib\\i18n.ts                          # 语言解析与中文回退
│   └── lib\\site-config.ts                   # 经契约批准的公共跳转地址
└── tests\\
    ├── contract\\
    ├── e2e\\
    └── unit\\
\`\`\`

使用 Bun、Next 16、Fumadocs、React 19 与 Tailwind 4，版本与现有 \`web/api-docs/\` 对齐。选择单一 Next 应用是为了让首页和 \`/docs\` 使用同一份语言、主题、公开契约与部署配置，避免两套前端的参数和链接漂移。

\`web/default/\` 和 \`web/api-docs/\` 是受保护的既有应用，只可作为只读技术参考；不得被本任务编辑、复制覆盖或用于承载新的公开路由。

## 4. 实施阶段

### 阶段 0：建立隔离工作区与公开契约基线

1. 在 \`blue-whale-api\` 依照其 \`CLAUDE.md\` 创建 task worktree；确认 \`git status --short\` 为空。
2. 记录 \`web/default/\`、\`web/api-docs/\` 的基线提交和关键页面截图，作为受保护面未被改动的证据。
3. 从网关负责人取得版本化、已批准的 \`public-video-api.openapi.yaml\`，将其放入 \`web/bluewhale-portal/contract/\`。契约必须标明版本、负责人、批准状态、生效时间，以及公开 \`base_url\`、模型、操作、参数、状态、错误、限流、控制台/SDK 链接、Webhook 和下载语义。
4. 若契约未包含以下任一项，停止在相应内容页编写具体事实，并请网关负责人补齐：POST 幂等键与保留期、网络超时后的重试规则、Webhook 地址配置方式、签名原文与算法、时间戳和重放窗口、密钥轮换、ACK 条件、重试策略、事件 ID 去重方式、下载 URL 的有效期。

验证：新 worktree 只有新增门户目录；受保护应用的文件哈希和基线截图未变化；契约通过 OpenAPI 语法校验且批准字段完整。

### 阶段 1：先写公开面与契约白名单测试

1. 在 \`web/bluewhale-portal/package.json\` 定义 \`dev\`、\`build\`、\`typecheck\`、\`format:check\`、\`test\`、\`test:e2e\`、\`validate:contract\` 和 \`check:public-surface\` 脚本。
2. 新建 \`tests/contract/public-contract.test.ts\`：先断言契约只含 \`seedance-2.0\`，且只含经批准的视频提交、查询、Webhook/结果相关公开操作；任何管理或非视频操作都必须使测试失败。
3. 新建 \`tests/unit/public-copy.test.ts\`：先断言站点文案和生成出的元数据不含禁用模型、通用网关话术、价格/额度词和管理 API 词。
4. 实现 \`scripts/validate-public-contract.ts\`，读取契约并校验上述 allowlist、版本/批准字段、模型 ID、外链和 Webhook 安全字段；不通过则阻断构建。
5. 实现 \`scripts/check-public-surface.ts\`，扫描 \`content/\`、\`src/\`、构建后的页面清单、站点地图与搜索索引；它必须拒绝未批准页面、操作和红线文案，同时允许必要的受保护许可证头部仅存在于既有未改文件中。

验证：在未放入批准契约或故意加入一个管理路径时，\`bun run validate:contract\` 与对应测试失败；恢复白名单后通过。

### 阶段 2：搭建门户壳、语言与安全配置

1. 新建 \`src/app/layout.tsx\`、\`src/app/[lang]/layout.tsx\`、\`src/app/[lang]/(marketing)/page.tsx\` 和 \`src/app/[lang]/docs/[[...slug]]/page.tsx\`；沿用 Fumadocs 的内容源，但只挂载门户自身的 \`content/docs/\`。
2. 在 \`src/lib/public-contract.ts\` 中从 \`contract/public-video-api.openapi.yaml\` 读取并类型化模型展示名、参数表、请求/响应字段、状态、文档示例、限流和公共链接；页面组件不得自行硬编码另一套 API 事实。
3. 在 \`src/lib/site-config.ts\` 只导出契约批准的正式域名、控制台、SDK 与商务链接；使用构建时校验，拒绝裸 IP、HTTP 正式链接、内部域名和未批准跳转。
4. 使用 \`[lang]\` 路由保留语言框架。完成所有中文内容；非中文路由使用明确的中文回退和可工作的语言切换，不能展示空白页或未翻译的内部键。
5. 设置 \`robots.ts\`、\`sitemap.ts\`、\`metadata\` 与安全响应头，只列出门户路由；禁止索引任何非白名单路径。

验证：\`tests/e2e/public-routes.spec.ts\` 先覆盖 \`/zh\`、\`/zh/docs\`、每个白名单文档页、\`robots.txt\`、站点地图和语言切换；任一非白名单/管理 URL 返回 404 或不被门户路由服务。

### 阶段 3：实现中文官网

1. 新建 \`src/components/marketing/site-header.tsx\`、\`hero.tsx\`、\`capability-grid.tsx\`、\`model-capability.tsx\`、\`quickstart.tsx\`、\`developer-entry.tsx\`、\`business-entry.tsx\` 和 \`site-footer.tsx\`。
2. Header 固定提供“视频生成、文档、控制台、主题、语言”入口；所有外链只来自 \`site-config.ts\`。
3. Hero 以“一句话，生成专业级视频”为核心，显示 \`seedance-2.0\`、异步任务和 Webhook；两个 CTA 分别进入控制台与文档。样片默认静音、可暂停，并在 \`prefers-reduced-motion\` 时只显示静态首帧与等价文字。
4. 能力区只表达文生视频、图生视频、已经由契约声明的控制能力和异步/Webhook；“视频生成产生的音频”只能在契约明确声明时出现，绝不形成独立 Audio API。
5. 模型区使用单模型卡与参数矩阵，逐项渲染契约内的分辨率、时长、比例、输入、输出和默认值；不得制作价格卡、套餐或其他模型墙。
6. 快速上手区从契约生成“提交、查询、下载”三段 curl，示例只使用脱敏值 \`sk-xxx\`，提示 Key 仅在服务端保管。
7. 开发者区只链接既有控制台、Python/JS SDK 和文档；商务区只链接已批准的合作入口；页脚显示经法务确认的“杭州玄海科技有限公司”主体信息，不添加未验证承诺。

验证：\`tests/e2e/marketing.spec.ts\` 在桌面和移动视口检查导航、两个 CTA、参数表、三段示例、静音/减少动画降级和页脚；截图基线由产品审核，且未出现红线内容。

### 阶段 4：实现公开 API 文档

1. 建立 \`content/docs/zh/meta.json\`，仅公开以下文档树：

   \`\`\`text
   快速开始
   认证与 API Key
   模型 / Seedance 2.0
   异步任务概览
   提交视频生成任务
   查询任务
   Webhook
   结果下载
   错误码与限流
   费用说明
   SDK
   FAQ
   \`\`\`

2. 在 \`quickstart.mdx\` 串联注册/创建 Key 的既有控制台入口、服务端提交、\`task_id\`、轮询或 Webhook、结果下载；不复刻控制台或 SDK 的配置逻辑。
3. 在 \`authentication.mdx\` 说明 Bearer Token、服务端保管与日志脱敏；绝不要求读者把真实 Key 放入浏览器。
4. 在 \`models/seedance-2.mdx\`、\`tasks/create.mdx\` 和 \`tasks/get.mdx\` 使用同一契约数据渲染参数、请求、响应、状态和 curl。POST 页必须明确幂等键、重复提交和超时重试语义；未被契约确认的字段不写入示例。
5. 在 \`webhooks.mdx\` 说明地址如何配置、事件类型、事件 ID、至少一次投递、去重、签名原文、算法、时间戳、重放窗口、密钥轮换、成功 ACK 和重试。不以 \`task_id\` 代替事件去重。
6. 在 \`results.mdx\` 只说明平台返回结果 URL、有效期和下载方式；不暴露上游 URL、存储桶、签名或内部渠道。
7. 在 \`errors-and-limits.mdx\` 依据契约列出 HTTP/业务错误及重试建议。在 \`billing.mdx\` 仅保留“费用以官方公告为准”。SDK 页只链接官方 SDK，FAQ 只回答接入问题。

验证：\`tests/e2e/docs-flow.spec.ts\` 从快速开始走到提交、查询、Webhook 和下载页面，检查相同的模型名、\`base_url\`、字段名和公共链接；\`check:public-surface\` 证明文档树、搜索和站点地图不含管理或非视频内容。

### 阶段 5：统一契约生成、质量与可访问性

1. 让官网参数表、curl、OpenAPI 操作块和文档示例都只从 \`public-contract.ts\` 输出；修改契约时必须由测试显示所有受影响页面。
2. 新建 \`tests/unit/contract-rendering.test.ts\`，覆盖模型、参数、状态、\`base_url\`、外链和示例在官网/文档两处的一致性。
3. 对导航、主题、语言、代码复制、参数表、折叠内容和视频控制补充键盘可操作性、可见焦点、语义标签和必要的 \`aria\` 文本。
4. 将图片/视频设为懒加载和尺寸固定；禁止自动播放有声媒体；检查移动端代码块可横向滚动、参数表可展开。

验证：\`bun run typecheck\`、单元测试、Playwright、格式检查和生产构建均通过；Lighthouse/浏览器审查确认没有阻塞的有声自动播放、明显布局跳动或不可键盘访问的主要交互。

### 阶段 6：预发布与上线

1. 在隔离环境用不含生产密钥的公开配置构建并部署门户；正式域名、API \`base_url\`、控制台和 SDK 外链均来自批准契约，不能沿用原型 IP。
2. 仅在受控 CI 的机密变量中执行 \`scripts/smoke-public-video-api.ts\`：以测试 Key 完成一次“提交 → 查询或 Webhook → 下载”的最小真实闭环。日志必须脱敏 Key、Webhook 密钥和结果 URL。
3. 发布前运行 \`validate:contract\`、\`check:public-surface\`、\`typecheck\`、\`format:check\`、\`test\`、\`test:e2e\`、\`build\`，保存命令输出、路由清单、站点地图和桌面/移动截图。
4. 发布后检查 \`/\`、\`/docs\`、语言切换、主题、控制台/SDK 外链和 404 行为；确认旧应用仍保持其基线，不把门户流量误路由到受保护前端。

验证：发布包具有全部自动检查记录、产品截图确认和一次脱敏的测试环境闭环记录；任何不一致、红线命中或未批准契约变更均阻止发布。

## 5. 建议的实现拆分

每个提交只完成一个可回滚的纵向切片，并在提交前执行对应测试：

1. 门户脚手架、公开契约解析和 allowlist 失败测试；
2. 中文官网壳、导航、Hero、能力与参数矩阵；
3. 快速上手、开发者/商务入口和媒体可访问性；
4. 中文文档树、公开 OpenAPI 页面和异步任务文档；
5. Webhook、结果、错误/限流、费用说明、SDK 与 FAQ；
6. 红线扫描、站点地图/搜索限制、端到端与视觉回归；
7. 受控环境闭环验证和部署配置。

在每个切片结束前，先进行代码审查和安全审查，再进入下一切片。不得在未通过契约校验的情况下以“临时文案”补写接口、域名、价格或回调安全语义。

## 6. 执行前检查清单

- [ ] 需求方确认新增隔离门户，而非替换受保护的旧站；
- [ ] BLUE WHALE 正式域名、控制台、SDK 和商务入口已批准；
- [ ] 公开视频 API 契约已冻结并含完整异步/Webhook/下载语义；
- [ ] 目标仓 task worktree 已创建，受保护应用基线已记录；
- [ ] 测试环境 Key 和 Webhook 接收端已在 CI 机密配置中准备，且不会写入仓库；
- [ ] 发布责任人确认可执行正式域名路由和部署。
