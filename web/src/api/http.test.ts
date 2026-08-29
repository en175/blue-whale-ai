import { describe, expect, it } from 'vitest';
import { readApiErrorMessage } from './http';

describe('readApiErrorMessage', () => {
  it('后台失败包络读 error 字段', () => {
    expect(
      readApiErrorMessage(
        { error: '每个原价只能有一个档位：已存在原价 ¥10 的档位' },
        409,
      ),
    ).toBe('每个原价只能有一个档位：已存在原价 ¥10 的档位');
  });

  it('用户侧优先 msg，其次 message', () => {
    expect(readApiErrorMessage({ msg: '账户已停用', error: 'ignored' }, 403)).toBe(
      '账户已停用',
    );
    expect(readApiErrorMessage({ message: '登录已过期' }, 401)).toBe('登录已过期');
  });

  it('空文案回退状态码', () => {
    expect(readApiErrorMessage({ error: '  ' }, 400)).toBe('请求失败（400）');
    expect(readApiErrorMessage(undefined, 500)).toBe('请求失败（500）');
  });
});
