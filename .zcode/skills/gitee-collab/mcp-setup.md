# Gitee 企业版 MCP Server 安装部署

适用:`mcp__gitee-ent__*` 工具在当前环境缺失时。官方仓库:https://gitee.com/oschina/mcp-gitee-ent,完整安装文档见其 README 与 docs/install/(覆盖 Claude / Cursor / Trae / Cline / Windsurf 各客户端)。

## 步骤

1. **确认缺失**:调用 `mcp__gitee-ent__get_user_info` 一次。返回用户信息 → 已接通,回 [SKILL.md](SKILL.md) 继续原任务;工具不存在或调用报错 → 继续本流程。
   完成标准:明确当前环境未接通 Gitee 企业版 MCP Server。

2. **生成项目级配置**:在项目根目录创建 `.agents/mcp.json`(若文件已存在,先读并向用户展示现状,不覆盖):

   ```json
   {
     "mcpServers": {
       "gitee-ent": {
         "command": "npx",
         "args": ["-y", "@gitee/mcp-gitee-ent@latest"],
         "env": {
           "GITEE_ENT_API_BASE": "https://api.gitee.com/enterprises",
           "GITEE_ENT_MCP_ACCESS_TOKEN": "<用户自己的私人令牌>"
         }
       }
     }
   }
   ```

   完成标准:配置文件已创建,令牌为占位符。

3. **用户补令牌**:请用户到 Gitee 个人设置生成 MCP 访问令牌(https://gitee.com/profile/mcp_gitee_ent_access_tokens)并填入 `GITEE_ENT_MCP_ACCESS_TOKEN`。真实令牌只由用户本人填写,skill 不代填、不收录任何令牌。
   完成标准:用户确认已填入自己的令牌。

4. **重载并验证**:提醒用户重启或重载客户端后,重新调用 `mcp__gitee-ent__get_user_info`。返回用户信息 → 接通,回 [SKILL.md](SKILL.md) 继续原任务。仍失败 → 逐一排查:令牌有效性、API 地址、Node/npx 环境;单机二进制方式见官方 README(go install 或 make build)。
   完成标准:`get_user_info` 返回用户信息。
