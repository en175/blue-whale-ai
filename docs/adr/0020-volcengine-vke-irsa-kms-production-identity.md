# ADR-0020：生产运行单元采用 VKE IRSA 与 KMS 凭据管理

- **状态**：Accepted
- **日期**：2026-07-15

Blue-Whale 的生产环境部署在火山引擎。为满足 ADR-0018 对工作负载身份、动态短期凭据和跨运行单元最小权限隔离的要求，Java Product API、Python Agent Worker 与 Java Generation Worker 部署到火山引擎 VKE 托管集群，各自使用独立的 Kubernetes ServiceAccount 与 IRSA 角色；生产 Secret Manager 采用同一火山引擎账号、同一区域的 KMS 凭据管理。每个角色只允许读取本运行单元声明的凭据，不允许通过共享主机身份或共享应用凭据跨单元读取。

当前火山引擎账号作为生产账号，生产资源统一位于 `cn-beijing`；VKE、KMS 与产品权威 ContentReview 使用同一生产账号和区域。开发、测试使用独立的非生产账号，不与生产建立跨账号 IRSA 信任，也不共享任何凭据。本地开发仍只允许使用被版本控制忽略的环境文件。

三个运行单元的凭据集合严格分离：

- Java Product API 只能读取数据库、Redis、短信服务等产品控制面凭据，禁止读取 LLM、图片或视频生成供应商 Token；
- Python Agent Worker 只能读取 LLM 供应商 Token，禁止读取数据库、Redis、JWT、TOS、ContentReview 或图片与视频供应商凭据；
- Java Generation Worker 只能读取图片和视频生成供应商 Token，禁止读取数据库、Redis、JWT、LLM 或 ContentReview 凭据。

KMS 凭据使用 `/blue-whale/prod/<runtime>/<provider>` 命名空间，每个 IRSA 角色只能读取自身运行单元的精确路径，禁止跨运行单元通配读取。TOS 与大模型应用防火墙直接使用对应 IRSA 临时身份，不保存长期 AK/SK；Python Agent Worker 和 Java Generation Worker 只通过 Java Product API 授予的短期输入或输出地址传输媒体。内部服务认证使用工作负载身份，不签发跨运行单元共享的静态 Token。

当前单机 Docker Compose 仅作为迁移基线，不再是生产目标。为三个运行单元分别使用独立 ECS 与 IAM 角色虽然可以形成身份隔离，但会增加主机管理和弹性成本；继续让多个容器共享一台 ECS 的实例身份则无法形成 Pod 级最小权限边界。VKE IRSA 引入 Kubernetes 运维成本，但能以工作负载身份直接满足隔离、轮换、撤销和访问审计要求。
