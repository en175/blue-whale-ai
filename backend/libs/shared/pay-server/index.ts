/* blue-whale-pay（支付网关）出入口。三个文件各管一件事：
 *   pay-egress      —— 地址与传输（唯一的出入口）
 *   pay-sign        —— jeepay 商户报文签名（协议）
 *   pay-order-ops   —— 下单/查单的业务语义
 */
export {
  PAY_SERVER_BASE_URL_ENV,
  PayServerConfigError,
  payServerBaseUrl,
  payServerUrl,
  payServerFetch,
} from "./pay-egress.js";
export { paySign, verifyPaySign } from "./pay-sign.js";
export {
  PAY_IF_CODE_HCCB,
  PAY_WAY_CODE_HCCB_QR,
  PAY_ORDER_STATE,
  PayGatewayError,
  unifiedOrder,
  queryOrder,
  type PayMerchantCredentials,
  type UnifiedOrderInput,
  type UnifiedOrderResult,
  type QueryOrderInput,
  type QueryOrderResult,
} from "./pay-order-ops.js";
