import { describe, expect, it } from 'vitest';
import { USER_DROPDOWN_MENU_ITEMS } from './menuItems';

describe('USER_DROPDOWN_MENU_ITEMS', () => {
  it('不包含个人资料入口，并保留账号信息与积分充值', () => {
    const keys = USER_DROPDOWN_MENU_ITEMS.map((item) => item.key);
    const labels = USER_DROPDOWN_MENU_ITEMS.map((item) => item.label);

    expect(keys).not.toContain('profile');
    expect(labels).not.toContain('个人资料');
    expect(keys).toEqual(expect.arrayContaining(['account', 'recharge']));
    expect(labels).toEqual(expect.arrayContaining(['账号信息', '积分充值']));
  });
});
