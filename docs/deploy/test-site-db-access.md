# 测试站数据库访问规范（IK65BP / ADR-0064）

> 一句话：**不直连、走隧道、用完断。**

## 三层访问模型

| 场景 | 通道 | 做法 |
|---|---|---|
| 日常开发 | 本地自足栈 | `pnpm db:fresh` + `deploy/typescript-baseline` compose，disposable 数据随便造 |
| 调试测试站数据 | SSH 隧道 | `scripts/tunnel-testsite-db.sh`（见下） |
| 集成验收 | HTTP only | `scripts/run-ik50gb-c-testsite-probe.sh`，永不接触数据库 |

## SSH 隧道使用

```bash
# 默认：本地 13306 → 测试站 3306，前台运行，Ctrl+C 断开
scripts/tunnel-testsite-db.sh

# 自定义端口 + 30 分钟自动断（防忘记）
scripts/tunnel-testsite-db.sh --local-port 23306 --timeout 30
```

隧道建立后，本地工具连 `127.0.0.1:<本地端口>`：

```bash
# 只读诊断账号（推荐，凭据向管理员索取，不写仓库）
mysql -h 127.0.0.1 -P 13306 -u bw_readonly -p blue_whale
```

**纪律**：

- 隧道仅用于**只读排查**；任何写操作（DDL/UPDATE/DELETE）必须走受控流程并留记录。
- 排查结束立即断开（Ctrl+C 或等超时）；禁止后台长期挂隧道。
- 本地配置文件中不得持久化测试站连接串。

## 服务器侧基线

- 公网 3306 已被防火墙封禁，仅容器内网（172.16.0.0/12）与 localhost 可访问；规则存 `/etc/sysconfig/iptables.rules`，由 `iptables-restore.service`（systemd，开机自启）恢复；
- 诊断使用只读账号 `bw_readonly`（仅 SELECT），root 仅运维操作用；
- root 密码定期轮换；凭据不进仓库、不进工单、不进聊天记录。
