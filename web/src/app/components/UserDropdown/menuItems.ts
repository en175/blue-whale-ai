export const USER_DROPDOWN_MENU_ITEMS = [
  { key: 'account', label: '账号信息' },
  { key: 'credits', label: '积分管理' },
  { key: 'settings', label: '系统设置' },
] as const;

export type UserDropdownMenuKey = (typeof USER_DROPDOWN_MENU_ITEMS)[number]['key'];
