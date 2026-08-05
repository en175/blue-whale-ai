/**
 * account-records.dto — 账户记录（充值/消费）接口契约 DTO（IK39UR）
 *
 * web BFF（/api/account/topups、/api/account/consumptions）按此结构返回，
 * 前端用 apiRequest<T>() 消费。命名约定: snake_case（与 BFF JSON 一致）。
 */

// ---------- GET /api/account/topups ----------

export type RechargeRecordDto = {
  trade_no: string;
  /** 获得积分 */
  credits: number;
  /** 实付金额（元） */
  amount_cny: number;
  /** 支付方式展示文案（微信/支付宝/扫码支付/其他） */
  payment_method: string;
  /** 成功 / 失败 / 进行中 */
  status: "success" | "failed" | "pending";
  /** unix 秒 */
  created_at: number;
};

// ---------- GET /api/account/consumptions ----------

export type ConsumptionRecordDto = {
  /** ⚠️ 非数据库主键：Go GetUserLogs 返回前会把 log.Id 覆写为位置展示 ID
   *  （model/log.go assignDisplayLogIds，startIdx+i+1）。单页内唯一可作 key；
   *  后续做翻页去重/深链时不得当主键用。 */
  id: number;
  /** 消耗积分（正数；展示层加负号） */
  credits: number;
  /** 生成内容摘要（生成图片/生成视频/内容生成） */
  summary: string;
  /** unix 秒 */
  created_at: number;
};

// ---------- 共用 ----------

export type AccountRecordsResponse<T> = {
  items: T[];
  total: number;
};
