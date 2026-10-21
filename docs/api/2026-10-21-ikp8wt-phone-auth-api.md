# 手机号注册登录改造：后端对接文档（IKP8WT / IKPC9D）

> 需求：IKP8WT「V1.2.0 账号与认证：手机号注册登录及内部老账号过渡」。
> 本文件对应后端子任务 **IKPC9D（账号主线）**，基线 `release/2026.09.29`。
> 后续子任务：IKPC9E（换绑 + 昵称编辑 + 操作单）、IKPC9F（内部老账号迁移），接口以各自文档为准。

---

## 0. 本次后端改了什么（给前端的一句话）

手机号验证码登录成为唯一 C 端登录方式：发码要带用途与滑块、登录要带协议勾选和浏览器标识；会话改成固定 7 天、每账号最多 3 个浏览器；`/api/me` 多返回一个昵称；所有业务失败多返回机器可读的 `error_code`。

前端需要改的只有四处：

1. 发码请求加 `purpose`
2. 登录请求加 `agreed_terms`、`client_id`
3. 登录态失效时按 `error_code` 区分「过期 / 被挤出」
4. 账号信息改读 `nickname`（缺省回退 `username`）

---

## 1. 响应信封与错误码

所有接口沿用 `{ code, msg, data }`。`code` 仍为 200 / 400 等数字；**新增可选字段 `error_code`**（字符串），前端用它分支，`msg` 直接展示。

```jsonc
// 成功
{ "code": 200, "msg": null, "data": { ... } }

// 失败
{
  "code": 400,
  "msg": "验证码错误，请重新输入（还可尝试4次）",
  "data": null,
  "error_code": "code_wrong"
}
```

| error_code | HTTP | 文案（后端已给） | 前端处理 |
|---|---|---|---|
| `terms_required` | 400 | 请先阅读并同意用户服务协议和隐私政策 | 高亮协议勾选框，不关闭弹窗 |
| `code_wrong` | 400 | 验证码错误，请重新输入（还可尝试N次） | 保留手机号，清空验证码，显示剩余次数 |
| `code_expired` | 400 | 验证码已失效，请重新获取 | 清空验证码，恢复「获取验证码」按钮 |
| `code_attempts_exhausted` | 400 | 验证码连续错误5次，已失效，请重新获取 | 同上，并提示需重新获取 |
| `invalid_purpose` | 200（body.code=400） | 验证码用途不正确 | 前端 bug，上报 |
| `account_disabled` | 403 | 账号已停用 | 终态提示，不提供重试 |
| `account_deleted` | 403 | 该手机号关联的账号已删除，暂无法登录 | 终态提示 |
| `phone_taken` | 200（body.code=400） | 该手机号已绑定其他账号 | 补绑/换绑流程用（换绑在 IKPC9E） |
| `session_expired` | 401 | 登录已过期，请重新验证 | 关闭业务操作，弹登录框 |
| `session_evicted` | 401 | 登录已失效，账号已在其他浏览器登录，请重新验证 | 同上，文案取 `msg` |
| `rate_limited` | 429 | 操作过于频繁，请稍后再试 | 按后端 `Retry-After` 倒计时 |
| `account_locked` | 429 | 尝试次数过多，账号已锁定，请稍后再试 | 仅密码登录（管理员）路径 |

`error_code` 只会出现在失败信封里；成功信封没有该字段。

---

## 2. 发送验证码

`POST /api/auth/send-code`

```jsonc
{
  "phone": "13800001234",   // 必填，中国大陆 11 位
  "purpose": "login"        // 必填，见下表
}
```

| purpose | 用途 | 本迭代是否可用 |
|---|---|---|
| `login` | 手机号登录 | ✅ IKPC9D |
| `bind` | 首次补绑手机号 | ✅ IKPC9D（页面入口在 IKPC9F） |
| `rebind_old` | 换绑：验证原手机号 | 契约预留，IKPC9E 启用 |
| `rebind_new` | 换绑：验证新手机号 | 契约预留，IKPC9E 启用 |
| `recovery` | 恢复查询授权 | 契约预留，IKPC9E 启用 |

成功：`{ code: 200, data: null }`。失败：手机号格式错误返回 `code: 400`、无 `error_code`（历史行为），短信渠道异常返回 `msg: "短信发送失败"`。

**过渡兼容**：不传 `purpose` 时后端按内部用途 `legacy` 发码，登录与补绑都接受这种码。它只为「后端先上线、前端尚未升级」的窗口存在；前端升级后必须显式传用途，`legacy` 会在下一轮删除。

**频控（所有用途共享，滚动窗口）**

- 同手机号：60 秒 1 条；24 小时 10 条
- 同 IP：60 秒 5 条；24 小时 50 条
- 超限返回 HTTP 429 + `error_code: rate_limited`

**验证码规则**

- 6 位数字，5 分钟有效，一次使用
- 同一码输错累计 5 次即作废
- 新码发送成功后，同手机号同用途的旧码立即失效
- 验证码按「号码 + 用途」隔离：显式 `login` 的码不能用于 `bind`（`legacy` 过渡码除外）

**滑块（火山 WAF）**

人机验证由火山引擎 WAF 的滑块拼图承担，挂在 `send-code` 上，后端不再签发挑战。前端行为：发码请求正常发出即可；若被 WAF 拦截，按 WAF 返回的挑战页/状态处理。滑块规则由运维配置，不在本仓代码内。

---

## 3. 手机号验证码登录

`POST /api/auth/login-by-code`

```jsonc
{
  "phone": "13800001234",
  "code": "123456",
  "agreed_terms": true,               // 必填且必须为 true；每次登录都要勾
  "client_id": "a1b2c3d4-..."         // 必填；同一浏览器持久化，见 §6
}
```

**`client_id` 怎么生成**：首次调用前在 `localStorage` 生成并持久保存（UUID v4 即可），此后同一浏览器所有登录请求都带同一个值。它的作用是「同浏览器重登替换旧会话」，不是设备指纹，也不参与鉴权。长度 8–64 个字符；过短/过长/缺失时后端按「独立浏览器」处理（不替换旧会话），仅用于兼容未升级的前端。

成功响应：

```jsonc
{
  "code": 200,
  "msg": null,
  "data": {
    "token": "eyJhbGciOi...",          // 登录令牌，同时写入 HttpOnly cookie bw_session
    "user_id": 42,
    "username": "用户0001",             // 登录名（唯一）
    "nickname": "蓝鲸用户_Ab12Cd",      // 展示名（可重名）；老账号回退 username
    "email": null,
    "phone": "13800001234",
    "is_new_user": true,                // 本次是否自动建号
    "has_password": false,
    "must_change_password": false
  }
}
```

**建号规则**：手机号未注册且无禁用/删除历史 → 自动建号（`username` 随机、`nickname` 为 `蓝鲸用户_` + 6 位字母数字），授予普通用户角色。不会发新人权益（沿用现有规则）。并发重复提交只会建一次号。

**登录成功后的前端动作**

- 弹窗关闭，回原目标页；无目标/无权限回首页
- 用 `token` 或 cookie 继续访问业务接口，两者后端都认
- `must_change_password = true` 时仍按现有逻辑强制改密

---

## 4. 退出登录

`POST /api/auth/logout`

- 只吊销当前浏览器会话，不影响其他设备
- 清 `bw_session` cookie
- 前端同时清 `client_id` 以外的登录缓存（`client_id` 保留）

---

## 5. 账号信息

`GET /api/me`

```jsonc
{
  "code": 200,
  "data": {
    "id": 42,
    "user_id": 42,
    "username": "用户0001",
    "nickname": "蓝鲸用户_Ab12Cd",   // 新增；无昵称时回退 username
    "email": null,
    "phone": "13800001234",
    "has_password": false,
    "must_change_password": false,
    "is_admin": false,
    "tier": "free",
    "roles": ["user"]
  }
}
```

- 账号信息弹窗的四行（ID / 昵称 / 手机号 / 积分）里，**昵称取 `nickname`，缺省取 `username`**
- 手机号后端返回明文，脱敏由前端展示层做
- 昵称编辑接口不在本次，IKPC9E 提供

---

## 6. 会话规则（前端必须遵守）

| 规则 | 行为 |
|---|---|
| 有效期 | 固定 7 天，从登录成功起算，**访问不续期** |
| 数量 | 同一账号最多 3 个浏览器会话；第 4 个登录淘汰最早登录的那个 |
| 同浏览器 | 带相同 `client_id` 重新登录 → 替换旧会话，只占 1 个名额 |
| 退出 | 只退出当前浏览器 |
| 换绑 / 改密 | 撤销该账号全部会话（换绑在 IKPC9E） |

**失效处理**

- 收到 `401 + session_expired` → 「登录已过期，请重新验证」
- 收到 `401 + session_evicted` → 「登录已失效，账号已在其他浏览器登录，请重新验证」
- 两种情况都关闭受保护操作、弹登录框；**不要**自动重试原请求
- 编辑中的未提交内容保留在当前标签；同账号重登后回原页续接，异账号不恢复

**多标签同步**：同一浏览器多标签共用一个 `client_id` 和一个会话；任一标签登录/退出后，其他标签通过现有广播机制同步登录态。

---

## 7. 上线耦合（必须同批）

本后端的登录接口要求 `agreed_terms: true`。当前线上前端（`web/src/custom/api/auth.ts`）登录请求还没带这个字段，**后端单独上线会让 C 端手机号登录全部失败**；补绑靠 `legacy` 用途兼容，不受影响。

结论：后端与前端登录弹窗改动必须进同一个 release 批次、一起上测试站；不要只合后端。

## 8. 兼容与保留项

| 项 | 本次行为 |
|---|---|
| `POST /api/auth/login`（账密） | 接口保留（后台管理端仍在使用），C 端入口由前端隐藏；该接口同样接受 `client_id` 参与会话替换 |
| `POST /api/auth/register`（账密注册） | 接口保留，C 端入口由前端隐藏 |
| `GET /api/auth/capabilities` | 不变（仍返回 password_login / password_register = true） |
| `POST /api/me/phone`（补绑） | 保留，错误码见 §1；换绑走 IKPC9E 新接口 |
| `token` + cookie 双通道 | 不变，前端沿用现有取值方式 |

> PRD 7.8 要求「旧普通密码登录/注册接口停用」，本期按产品口径暂不执行，仅隐藏入口；后续由产品确认后另行处理。

---

## 9. 未包含在本迭代（IKPC9E / IKPC9F 交付）

| 能力 | 工单 | 预期接口 |
|---|---|---|
| 换绑手机号 | IKPC9E | `POST /api/me/phone/rebind/verify-current`、`POST /api/me/phone/rebind` |
| 昵称编辑 | IKPC9E | `PATCH /api/me/nickname` |
| 操作结果查询（弱网/超时恢复） | IKPC9E | `GET /api/auth/operations/:id` |
| 内部老账号迁移 | IKPC9F | `POST /api/auth/migration/verify-password`、`/bind-phone` |

前端可先按本文件改登录主线；以上接口在后端合并后补充文档。
