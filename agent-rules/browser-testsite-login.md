# 浏览器自动化测试站登录

浏览器自动化（web-gui-tester、control-browser 等 GUI 验证）访问需要登录的 Blue-Whale 页面时，按本文件登录。本地联调的端口与后端形态见 `.claude/skills/start-local-services/SKILL.md`。

## 登录步骤

1. 读取 `~/.bw-test-login.env`（600 权限个人文件）中的 `BW_TEST_LOGIN_USERNAME` 与 `BW_TEST_LOGIN_PASSWORD`。
   完成判据：两个键都取到非空值；文件缺失或键为空 → 走「兜底」。
2. 打开目标页面并触发登录弹窗（LoginModal），保持默认「账号密码」态。
3. 定位用户名与密码输入框，GUI 填入两个值，完成弹窗要求的必选项（如协议勾选），点击登录。
   完成判据：页面呈现已登录态（用户信息/积分徽章可见，弹窗关闭）。
4. 对话、报告、commit message 里以「已从 ~/.bw-test-login.env 注入凭据」表述；凭据明文只出现在浏览器输入动作中（ADR-0064 / ADR-0122 口径）。

## 兜底

凭据文件缺失或密码失效时，停止自动化并报告用户，附本创建指引，等补齐后从步骤 1 重新执行：

```bash
cat > ~/.bw-test-login.env << 'EOF'
BW_TEST_LOGIN_USERNAME=<账号>
BW_TEST_LOGIN_PASSWORD=<密码>
BW_TEST_API_BASE_URL=http://14.103.43.52:3001
EOF
chmod 600 ~/.bw-test-login.env
```

## 边界

- 写操作落在测试站真实库（同事可见）；消耗积分的操作（提交生成、充值）先向用户告知再执行。
- 登录态过期即从步骤 1 重走；验证码登录态留给真人操作，Agent 只走账号密码态。
