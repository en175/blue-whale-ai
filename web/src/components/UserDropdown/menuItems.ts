/**
 * 用户下拉菜单项。
 * IKBL2I：暂时隐藏「个人资料」入口；恢复时取消 profile 行注释，并同步恢复 ProfileModal 挂载。
 */
export const USER_DROPDOWN_MENU_ITEMS = [
  // { key: 'profile', label: '个人资料' },
  { key: 'account', label: '账号信息' },
  { key: 'recharge', label: '积分充值' },
  { key: 'settings', label: '系统设置' },
] as const;

export type UserDropdownMenuKey = (typeof USER_DROPDOWN_MENU_ITEMS)[number]['key'];
