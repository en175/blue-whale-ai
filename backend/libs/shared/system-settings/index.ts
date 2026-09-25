/* ============================================
 * 系统设置域的**公开面** —— 域外只能从这里进来
 *
 * 与 `@lib/shared/identity/index.js` 同一条理由：在它之前，「这个域对外给什么」没有声明，
 * 只有调用方**实际 import 了什么**。充值域取 `SystemSettingsConfigError` 时深进了
 * `credentials-crypto.js`（那是封/解封的**实现**文件），于是加密细节成了事实上的公开面。
 *
 * ⚠️ 这里只声明**调用方要用的**：服务本身、它的视图/入参类型、以及
 *    「配置错了」这一类失败（充值域要把它翻成 503，与「网关业务失败」分开处置）。
 *    封/解封函数（`sealSecret` / `openSecret` / `maskSecret`）**不出现在这里**：
 *    凭证的读写只能经 `SystemSettingsService`，绕过它直接加解密等于绕过了脱敏与合并规则。
 * ============================================ */
export { SystemSettingsModule } from "./system-settings.module.js";
export {
  SystemSettingsService,
  type PayMerchantConfig,
  type SystemCredentials,
  type SystemPolicy,
  type SystemRateLimit,
  type SystemSettingsPatch,
  type SystemSettingsView,
} from "./system-settings.service.js";
export {
  SYSTEM_SETTINGS_SECRET_ENV,
  SystemSettingsConfigError,
} from "./credentials-crypto.js";
