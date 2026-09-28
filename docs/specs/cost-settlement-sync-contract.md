# new-api → 蓝鲸端 结算结果同步契约（IK9VZ0 多退少补）

> 本契约是 **blue-whale-api（new-api，Go 独立仓库）** 侧实施多退少补结算端的依据；
> 蓝鲸端（blue-whale-ai，Node）已按本契约实现接收端（`internal/cost-settlements` + `cost_adjustments` 审计）。
> 状态：2026-08-20 评审确认。

## 方向与语义

- **new-api 是 quota 账本唯一权威**：退/补的**执行**只发生在 new-api 内部（直接改用户 quota）。
- 结算完成后，new-api 把结果**一次性批量**同步给蓝鲸端（服务端到服务端），蓝鲸端**只记账、不改余额**。
- 用户端（web 前端 + 用户可调 API）**不感知、不可触达**该通道；蓝鲸端无用户"退款/补偿"入口。

## 同步方式（已定 2026-08-20：方案 A，new-api 主动推送）

- **A（已选）**：new-api **主动推送** `POST <蓝鲸内部端点>/api/internal/cost-settlements`（批量，含 batch_no）——仿 bluewhalepay 回调；蓝鲸端不持有任何 new-api 凭证，封装边界最干净。
- ~~B. 蓝鲸端定时拉取~~（未选：需蓝鲸侧配置 new-api 查询凭证，破坏"Node 零凭证"边界）。

## 鉴权

- Header：`Authorization: Bearer <共享密钥>`
- 共享密钥由运维在蓝鲸端 env 配置 `COST_SETTLEMENT_SERVICE_TOKEN`，与 new-api 侧约定同一值。
- 蓝鲸端用 `timingSafeEqual` 校验；失败返回 `401 unauthorized`。

## 端点

```
POST /api/internal/cost-settlements
Content-Type: application/json
Authorization: Bearer <shared-token>
```

## 载荷（batch 元素）

```json
{
  "batchNo": "ADJ-20260820-001",
  "settledAt": "2026-08-20T03:00:00Z",
  "items": [
    {
      "jobId": "10086",
      "userId": 42,
      "action": "refund",
      "amountFen": 1285,
      "reason": "reserved vs actual 偏差对账"
    }
  ]
}
```

字段契约：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `batchNo` | string ≤64 | ✅ | new-api 批次号（整批幂等键） |
| `settledAt` | string(ISO8601) | 可选 | new-api 结算时间（审计留痕） |
| `items[]` | array | ✅ | 至少 1 项 |
| `items[].jobId` | string | 可选 | 关联生成任务（无 job 的调整可省略，仅靠整批幂等） |
| `items[].userId` | number | ✅ | 用户 ID |
| `items[].action` | `"refund" \| "supplement"` | ✅ | 退 / 补 |
| `items[].amountFen` | number（整数，分） | ✅ | 调整金额（分）；refund=多扣退回，supplement=少扣补收 |
| `items[].reason` | string ≤255 | ✅ | 调整原因 |

> `amountFen` 单位是**分**（与 cost_reservations 记账口径一致）；new-api 侧按
> `quota → 分`（quota ÷ 500,000 × 7.3 × 100）换算后推送。

## 幂等键

- `batchNo` 唯一（整批幂等）：同一 batch 重复推送 → 蓝鲸端返回 `duplicate`（HTTP 200），不重复落库。
- `(jobId, action)` 唯一（单项幂等）：不同 batch 对同 job 同 action 重复调整 → 蓝鲸端落库抛错（500），
  new-api 应避免生成此类批次（对账按 job 维度聚合后再推送）。

## 蓝鲸端消费语义（只记账）

1. 落 `cost_adjustments` 审计（`status=applied`，记录 `new_api_snapshot`）。
2. 对齐 `cost_reservations`：`settled` 预留的 `actual_amount_fen` 以结算结果修正
   （supplement → actual += amount_fen；refund → actual -= amount_fen，下限 0）。
3. 重复批次直接跳过（幂等），返回已确认，不报错。

## 响应

```json
{ "batch_no": "ADJ-20260820-001", "status": "applied" }
```

- `status`：`applied`（本次落库）/ `duplicate`（整批重复，幂等跳过）。
- 鉴权失败 `401`；载荷非法 `400`；落库异常 `500`（new-api 侧重试）。

## new-api 侧实施要点（他方）

1. 内部对账：对比 relay 结算流水与 job 预留（quota 维度），计算退/补金额（分）。
2. 执行退/补：直接改用户 quota（账本权威，**不要**走蓝鲸端）。
3. 生成结算批（`batchNo` 唯一、按 job 聚合 action），推送上述端点。
4. 推送失败/超时重试（幂等保证安全）；推送成功后标记该批已同步，防重复生成。

## 边界验证（蓝鲸端，CI 可跑）

```bash
# 用户端与 internal 目录外的路由不得引用该通道
rg "cost-settlements|cost_adjustments" web/src backend/apps/blue-whale/src/api --glob '!**/internal/**'
# 消费端不持有任何管理凭证/改余额调用
# （原前半段还 grep 过一个 root access token 变量；该凭证 2026-09-25 已整条退役，
#  全项目只剩 NEW_API_UPSTREAM_KEY 一把上游凭证，故这里只留改余额这一条）
rg "/api/user/manage" backend/libs/shared/cost-reconciliation
```
