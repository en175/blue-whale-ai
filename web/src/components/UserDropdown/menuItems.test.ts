import { describe, expect, it } from 'vitest';
import { USER_DROPDOWN_MENU_ITEMS } from './menuItems';

describe('USER_DROPDOWN_MENU_ITEMS', () => {
  it('不包含个人资料入口，保留账号信息，积分充值已迁到顶栏积分超市', () => {
    const keys = USER_DROPDOWN_MENU_ITEMS.map((item) => item.key);
    const labels = USER_DROPDOWN_MENU_ITEMS.map((item) => item.label);

    expect(keys).not.toContain('profile');
    expect(labels).not.toContain('个人资料');
    expect(keys).toEqual(expect.arrayContaining(['account']));
    expect(labels).toEqual(expect.arrayContaining(['账号信息']));
    expect(keys).not.toContain('recharge');
    expect(labels).not.toContain('积分充值');
  });
});
