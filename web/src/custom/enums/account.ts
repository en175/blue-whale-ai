export type OrderStatus =
  | 'pending'
  | 'paid_pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'grant_failed';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid_pending: '支付成功待到账',
  paid: '已到账',
  failed: '支付失败',
  expired: '已取消',
  grant_failed: '到账异常',
};

export const SOURCE_LABELS: Record<string, string> = {
  purchased: '充值到账',
  bonus: '充值赠送',
  gift: '赠送',
  compensation: '补偿',
  daily: '每日赠送',
  invite: '邀请奖励',
  register: '注册赠送',
  redeem: '兑换',
  subscription: '订阅',
};

export type ExportScope = 'orders' | 'gain' | 'consume';

export interface ExportFieldOption {
  key: string;
  label: string;
}

export const EXPORT_FIELDS: Record<ExportScope, ExportFieldOption[]> = {
  orders: [
    { key: 'created_at', label: '下单时间' },
    { key: 'product_name', label: '商品名称' },
    { key: 'amount_yuan', label: '支付金额' },
    { key: 'credits', label: '到账积分' },
    { key: 'status', label: '状态' },
  ],
  gain: [
    { key: 'created_at', label: '获取时间' },
    { key: 'source', label: '获取来源' },
    { key: 'detail', label: '获取详情' },
    { key: 'activated_at', label: '积分生效时间' },
    { key: 'expires_at', label: '积分到期时间' },
    { key: 'amount', label: '积分值' },
  ],
  consume: [
    { key: 'created_at', label: '消耗时间' },
    { key: 'task_type', label: '任务类型' },
    { key: 'model_label', label: '模型' },
    { key: 'detail', label: '任务详情' },
    { key: 'credits', label: '消耗积分' },
  ],
};
