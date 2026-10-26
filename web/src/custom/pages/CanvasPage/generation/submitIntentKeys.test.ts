import { describe, expect, it } from 'vitest';
import { createSubmitIntentKeys } from './submitIntentKeys';


describe('submitIntentKeys 一次用户意图一把 key', () => {
  it('同 scope 同签名复用同一把（双击 / 响应丢了原样重发）', () => {
    const keys = createSubmitIntentKeys();
    const first = keys.keyFor('d1', '{"prompt":"画一只蓝鲸"}');
    expect(keys.keyFor('d1', '{"prompt":"画一只蓝鲸"}')).toBe(first);
  });

  it('签名变了换新钥匙（用户改了参数再点，复用会撞服务端同键异载荷 409）', () => {
    const keys = createSubmitIntentKeys();
    const before = keys.keyFor('d1', '{"prompt":"画一只蓝鲸"}');
    expect(keys.keyFor('d1', '{"prompt":"画两只蓝鲸"}')).not.toBe(before);
  });

  it('不同 scope 互不相干（两张卡各自一把）', () => {
    const keys = createSubmitIntentKeys();
    expect(keys.keyFor('d1', 'same')).not.toBe(keys.keyFor('d2', 'same'));
  });

  it('settle 之后同签名也发新钥匙：任务已受理，再提交是另一次意图（要拿新作品，不是重放旧任务）', () => {
    const keys = createSubmitIntentKeys();
    const first = keys.keyFor('d1', '{"prompt":"画一只蓝鲸"}');
    keys.settle('d1');
    expect(keys.keyFor('d1', '{"prompt":"画一只蓝鲸"}')).not.toBe(first);
  });

  it('受理只收走本 scope 的钥匙，其他卡不受影响', () => {
    const keys = createSubmitIntentKeys();
    const other = keys.keyFor('d2', 'same');
    keys.keyFor('d1', 'same');
    keys.settle('d1');
    expect(keys.keyFor('d2', 'same')).toBe(other);
  });
});
