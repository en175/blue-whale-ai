/**
 * 用户下拉菜单项。
 * IKBL2I：暂时隐藏「个人资料」入口；恢复时取消 profile 行注释，并同步恢复 ProfileModal 挂载。
 * 「积分充值」已移到首页顶栏的「积分超市」入口（同源弹窗），这里不再重复给一个入口。
 */
export const USER_DROPDOWN_MENU_ITEMS = [
  // { key: 'profile', label: '个人资料' },
  { key: 'account', label: '账号信息' },
  { key: 'credits', label: '积分管理' },
  { key: 'settings', label: '系统设置' },
] as const;

export type UserDropdownMenuKey = (typeof USER_DROPDOWN_MENU_ITEMS)[number]['key'];
