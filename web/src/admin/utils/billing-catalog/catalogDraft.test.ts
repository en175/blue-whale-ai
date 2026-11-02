import { describe, expect, it } from 'vitest';
import {
  BASE_UNIT_OPTIONS,
  creditsToMc,
  describePriceInHuman,
  formFromRule,
  isCatalogDirty,
  mcToCredits,
  priceUnitLabel,
  parseCatalog,
  readCreditsPerYuan,
  readDiscountPolicy,
  ruleFormError,
  ruleFromForm,
  serializeCatalog,
  siteCatalogDocument,
  withCreditsPerYuan,
  withDiscountPolicy,
  emptyRuleForm,
  type RuleForm,
} from './catalogDraft';

const DOC = {
  schemaVersion: 1,
  currency: 'CNY',
  creditsPerYuan: 15,
  futureFlag: '别删我',
  models: {
    'seedance-2.5': {
      text2video: {
        baseUnit: 'usage.seconds',
        basePrice: { kind: 'const', value: 100000 },
        unitDenominator: 1,
        minCredits: 1,
        maxCredits: 50,
        rounding: 'halfUp',
        dims: { 'usage.referenceCount': 4000 },
        futureRuleField: true,
      },
    },
  },
  discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
};

const DOC_RULE = DOC.models['seedance-2.5'].text2video;

describe('parseCatalog', () => {
  it('空文本 → 一份能编译过的骨架（「还没有生效目录」时用）', () => {
    const doc = parseCatalog('');

    expect(doc.schemaVersion).toBe(1);
    expect(doc.currency).toBe('CNY');
    expect(doc.creditsPerYuan).toBe(15);
    expect(doc.discountPolicy).toEqual({ stackMode: 'multiply', floorFactorBp: 3000 });
    expect(doc).not.toHaveProperty('models');
  });

  it('不是合法 JSON → 抛中文错误（这句话要直接给用户看）', () => {
    expect(() => parseCatalog('{ 不是 json')).toThrow(/不是合法 JSON/);
  });

  it('合法 JSON 但不是对象（数组）→ 拒绝', () => {
    expect(() => parseCatalog('[1,2,3]')).toThrow(/必须是 JSON 对象/);
  });
});

describe('改文档不碰不认识的字段', () => {
  it('换算率可以清空成 null（不替人补默认值）', () => {
    const next = withCreditsPerYuan(DOC, null);

    expect(readCreditsPerYuan(next)).toBeNull();
    expect(serializeCatalog(next)).toContain('"creditsPerYuan":null');
  });

  it('折扣策略只改给的字段（stackMode 不动 floorFactorBp）', () => {
    const next = withDiscountPolicy(DOC, { floorFactorBp: 5000 });

    expect(readDiscountPolicy(next)).toEqual({ stackMode: 'multiply', floorFactorBp: 5000 });
  });
});

describe('siteCatalogDocument（白名单重建）', () => {
  it('★ 重建出来的只有 4 个键：旧 models 段与顶层未知字段都不在', () => {
    const doc = siteCatalogDocument(20, { stackMode: 'best', floorFactorBp: 4000 });

    expect(Object.keys(doc).sort()).toEqual([
      'creditsPerYuan',
      'currency',
      'discountPolicy',
      'schemaVersion',
    ]);
    expect(doc).not.toHaveProperty('models');
    expect(doc).not.toHaveProperty('futureFlag');
  });

  it('两个值按入参写进去（换算率是数、折扣两项逐字照写）', () => {
    expect(siteCatalogDocument(20, { stackMode: 'best', floorFactorBp: 4000 })).toEqual({
      schemaVersion: 1,
      currency: 'CNY',
      creditsPerYuan: 20,
      discountPolicy: { stackMode: 'best', floorFactorBp: 4000 },
    });
  });

  it('换算率清空成 null 也照写（不替人补默认值）', () => {
    const doc = siteCatalogDocument(null, { stackMode: 'multiply', floorFactorBp: 3000 });

    expect(readCreditsPerYuan(doc)).toBeNull();
  });

  it('每次调用都是新对象（页面拿它当草稿，不该与骨架共享引用）', () => {
    const a = siteCatalogDocument(15, { stackMode: 'multiply', floorFactorBp: 3000 });
    const b = siteCatalogDocument(15, { stackMode: 'multiply', floorFactorBp: 3000 });

    expect(a).not.toBe(b);
    expect(a.discountPolicy).not.toBe(b.discountPolicy);
    (a.discountPolicy as { stackMode: string }).stackMode = 'best';
    expect(readDiscountPolicy(b).stackMode).toBe('multiply');
  });
});

describe('isCatalogDirty', () => {
  it('★ 同一份原文重建两次 → 逐字相同，不算改动（否则点一次保存就多一个内容相同的版本）', () => {
    const rebuild = () => siteCatalogDocument(readCreditsPerYuan(DOC), readDiscountPolicy(DOC));

    expect(isCatalogDirty(rebuild(), rebuild())).toBe(false);
    expect(rebuild()).not.toHaveProperty('models');
  });

  it('真的改了 → 算改动', () => {
    const baseline = siteCatalogDocument(readCreditsPerYuan(DOC), readDiscountPolicy(DOC));

    expect(
      isCatalogDirty(
        siteCatalogDocument(20, readDiscountPolicy(DOC)),
        baseline,
      ),
    ).toBe(true);
    expect(
      isCatalogDirty(
        siteCatalogDocument(readCreditsPerYuan(DOC), { stackMode: 'best', floorFactorBp: 3000 }),
        baseline,
      ),
    ).toBe(true);
  });

  it('改完又改回去 → 不算改动', () => {
    const back = withCreditsPerYuan(withCreditsPerYuan(DOC, 20), 15);

    expect(isCatalogDirty(back, DOC)).toBe(false);
  });
});

describe('单位换算', () => {
  it('mc → 积分文本：1 积分 = 1000 mc，小数按位留着', () => {
    expect(mcToCredits(100000)).toBe('100');
    expect(mcToCredits(1000)).toBe('1');
    expect(mcToCredits(500)).toBe('0.5');
    expect(mcToCredits(499)).toBe('0.499');
    expect(mcToCredits(1)).toBe('0.001');
  });

  it('积分 → mc', () => {
    expect(creditsToMc(70)).toBe(70000);
    expect(creditsToMc(1)).toBe(1000);
    expect(creditsToMc(0.5)).toBe(500);
    expect(creditsToMc(0.12)).toBe(120);
  });

  it('★ 硬不变式：mc → 积分文本 → 换回 mc 必须逐位相等（否则「打开→保存」会把价挪走）', () => {
    const samples = [
      1, 2, 499, 500, 1000, 1800, 10000, 15000, 33333, 100000, 420000, 555000, 690000,
      765000, 1050000, 1155000, 999999, 1234567,
    ];
    for (const mc of samples) {
      const text = mcToCredits(mc);
      expect(creditsToMc(Number(text)), `mc=${mc} → ${text}`).toBe(mc);
    }
  });

  it('积分数文本去掉尾随 0：整数积分显示成 1050，不是 1050.000', () => {
    expect(mcToCredits(1050000)).toBe('1050');
    expect(mcToCredits(630000)).toBe('630');
    expect(mcToCredits(1800)).toBe('1.8');
  });

  it('人类可读的单价：直接用积分数表达', () => {
    expect(describePriceInHuman(1050000, '百万 token')).toBe('1050 积分 / 百万 token');
    expect(describePriceInHuman(1050000)).toBe('1050 积分');
    expect(describePriceInHuman(13000)).toBe('13 积分');
  });

  it('单价的量纲由 unitDenominator + baseUnit 一起决定', () => {
    expect(priceUnitLabel({ baseUnit: 'usage.c', unitDenominator: 1000000 })).toBe('1000000 个单位');
    expect(priceUnitLabel({ baseUnit: 'constant:1', unitDenominator: 1 })).toBe('次');
    expect(priceUnitLabel({ baseUnit: 'usage.succeededSlots', unitDenominator: 1 })).toBe('张');
    expect(priceUnitLabel({ baseUnit: 'usage.seconds', unitDenominator: 1 })).toBe('秒');
    expect(priceUnitLabel({ baseUnit: 'usage.characters', unitDenominator: 100 })).toBe('每 100 个字符');
  });
});

describe('ruleFormError（只拦表单表达不出来的东西）', () => {
  const form = (patch: Partial<RuleForm> = {}): RuleForm => ({
    ...emptyRuleForm(),
    modelId: 'm',
    taskType: 't',
    priceValue: { value: '70', originalMc: null },
    ...patch,
  });

  it('模型 / 任务类型 / 基准维度不能空', () => {
    expect(ruleFormError(form({ modelId: ' ' }))).toBe('模型 ID 必填');
    expect(ruleFormError(form({ taskType: '' }))).toBe('任务类型必填');
    expect(ruleFormError(form({ baseUnit: '' }))).toBe('基准维度必填');
  });

  it('常数单价必须是数（积分；整数报价与小数报价都收）', () => {
    expect(ruleFormError(form({ priceValue: { value: '', originalMc: null } }))).toBe(
      '基准单价必填，且是一个数（单位：积分 / 每 unitDenominator 个单位，如 70）',
    );
    expect(ruleFormError(form({ priceValue: { value: '不是数', originalMc: null } }))).toBe(
      '基准单价必填，且是一个数（单位：积分 / 每 unitDenominator 个单位，如 70）',
    );
    expect(ruleFormError(form({ priceValue: { value: '-1', originalMc: null } }))).toContain(
      '基准单价必填',
    );
    expect(ruleFormError(form({ priceValue: { value: '70', originalMc: null } }))).toBeNull();
    expect(ruleFormError(form({ priceValue: { value: '0.12', originalMc: null } }))).toBeNull();
  });

  it('查表方式至少要有一行，且键不能空', () => {
    expect(ruleFormError(form({ priceKind: 'table', priceTable: [] }))).toBe(
      '价格表至少要有一行（规格键 → 单价）',
    );
    expect(
      ruleFormError(
        form({ priceKind: 'table', priceTable: [{ key: '', value: '10', originalMc: null }] }),
      ),
    ).toBe('价格表的键不能为空');
  });

  it('★ 常数方式下不看价格表：收起来那一栏里的空行不该拦住保存', () => {
    expect(ruleFormError(form())).toBeNull();
    expect(
      ruleFormError(
        form({ priceTable: [{ key: 'size=1k', value: '不是数字', originalMc: null }] }),
      ),
    ).toBeNull();
  });

  it('键值行：键不能空，值必须是整数', () => {
    expect(ruleFormError(form({ dims: [{ key: 'usage.seconds', value: 'abc' }] }))).toBe(
      '维度表「usage.seconds」的值必须是整数',
    );
    expect(
      ruleFormError(form({ dims: [{ key: 'usage.seconds', value: '4000' }] })),
    ).toBeNull();
    expect(ruleFormError(form({ dims: [{ key: ' ', value: '1' }] }))).toBe(
      '维度表的键不能为空',
    );
  });

  it('单位分母 / 上下限留空可以，填了就必须是整数', () => {
    expect(ruleFormError(form({ unitDenominator: '' }))).toBeNull();
    expect(ruleFormError(form({ unitDenominator: 'x' }))).toContain('单位分母必须是整数');
    expect(ruleFormError(form({ maxCredits: '' }))).toBeNull();
    expect(ruleFormError(form({ maxCredits: '2.5' }))).toContain('积分上限必须是整数');
  });
});

describe('ruleFromForm', () => {
  const form = (patch: Partial<RuleForm> = {}): RuleForm => ({
    ...emptyRuleForm(),
    modelId: 'm',
    taskType: 't',
    baseUnit: 'usage.seconds',
    priceValue: { value: '100', originalMc: 100000 },
    unitDenominator: '1',
    minCredits: '1',
    maxCredits: '',
    ...patch,
  });

  it('常数单价：原 mc 写回，上限留空写 null（显式表达「不封顶」）', () => {
    const rule = ruleFromForm(form(), {});

    expect(rule).toMatchObject({
      baseUnit: 'usage.seconds',
      basePrice: { kind: 'const', value: 100000 },
      unitDenominator: 1,
      minCredits: 1,
      maxCredits: null,
    });
  });

  it('★ 积分文本原样写回时，用的是**目录里的原 mc**（一位不差）', () => {
    const unchanged = form({ priceValue: { value: mcToCredits(100000), originalMc: 100000 } });
    expect(ruleFromForm(unchanged, {}).basePrice).toMatchObject({ value: 100000 });

    const edited = form({ priceValue: { value: '70', originalMc: 100000 } });
    expect(ruleFromForm(edited, {}).basePrice).toMatchObject({ value: 70000 });
  });

  it('不编辑的字段从原规则带过来（usageSemantic / by 不该被这次编辑抹掉）', () => {
    const rule = ruleFromForm(
      form(),
      {
        usageSemantic: 'openai',
        basePrice: { by: ['size'] },
      },
    );

    expect(rule.usageSemantic).toBe('openai');
    expect(rule.basePrice).toEqual({ by: ['size'], kind: 'const', value: 100000 });
  });

  it('查表：table 与 kind 一起换，空 dims 不写进目录', () => {
    const rule = ruleFromForm(
      form({
        priceKind: 'table',
        priceTable: [
          { key: 'size=1k', value: '70', originalMc: null },
          { key: 'size=2k', value: '100', originalMc: 100000 },
        ],
      }),
      {},
    );

    expect(rule.basePrice).toMatchObject({
      kind: 'table',
      value: null,
      table: { 'size=1k': 70000, 'size=2k': 100000 },
    });
    expect(rule).not.toHaveProperty('dims');
  });

  it('★ 维度键重复直接报错，不悄悄覆盖（覆盖会丢掉一条本来生效的配置）', () => {
    expect(() =>
      ruleFromForm(
        form({
          dims: [
            { key: 'usage.seconds', value: '4000' },
            { key: 'usage.seconds', value: '8000' },
          ],
        }),
        {},
      ),
    ).toThrow(/键重复/);
  });

  it('★ 价格表键重复同样报错', () => {
    expect(() =>
      ruleFromForm(
        form({
          priceKind: 'table',
          priceTable: [
            { key: 'resolution=1080p|video=0', value: '51', originalMc: null },
            { key: 'resolution=1080p|video=0', value: '77', originalMc: null },
          ],
        }),
        {},
      ),
    ).toThrow(/键重复/);
  });

  it('维度按万分比整数写入', () => {
    const rule = ruleFromForm(
      form({
        dims: [{ key: 'usage.succeededSlots', value: '4000' }],
      }),
      {},
    );

    expect(rule.dims).toEqual({ 'usage.succeededSlots': 4000 });
  });
});

describe('formFromRule → ruleFromForm 往返', () => {
  it('读出来再写回去，规则本身不变（编辑没碰过的字段不该被改写）', () => {
    const original = DOC_RULE;

    const back = ruleFromForm(
      formFromRule('seedance-2.5', 'text2video', original),
      original,
    );

    expect(back).toEqual(original);
  });

  it('★ 没改任何东西的往返对**每一档价**都逐位相等（打开看一眼、点保存不该挪价）', () => {
    const rule = {
      baseUnit: 'usage.c',
      basePrice: {
        kind: 'table',
        by: ['resolution', 'video'],
        table: {
          'resolution=1080p|video=0': 765000,
          'resolution=1080p|video=1': 465000,
          'resolution=480p|video=0': 690000,
          'resolution=480p|video=1': 420000,
          'resolution=720p|video=0': 33333,
          'resolution=720p|video=1': 1,
        },
      },
      unitDenominator: 1000000,
      minCredits: 1,
      maxCredits: null,
      rounding: 'halfUp',
    };

    const back = ruleFromForm(formFromRule('m', 'video', rule), rule);

    expect(back.basePrice).toMatchObject({ kind: 'table', table: rule.basePrice.table });
  });

  it('空规则给出一份能直接编辑的默认表单', () => {
    const form = formFromRule('m', 't', {});

    expect(form).toMatchObject({
      baseUnit: '',
      priceKind: 'const',
      unitDenominator: '1',
      minCredits: '1',
      rounding: 'halfUp',
    });
  });
});

describe('token 计价的规则编辑', () => {
  const TOKEN_RULE = {
    baseUnit: 'usage.c',
    basePrice: { kind: 'table', by: ['video'], table: { 'video=0': 555000, 'video=1': 330000 } },
    unitDenominator: 1000000,
    minCredits: 1,
    maxCredits: null,
    rounding: 'halfUp',
  };

  it('★ 计价方式选「单价待配」→ 写入 kind=unset，且**不带任何价**', () => {
    const form = { ...emptyRuleForm(), modelId: 'seedance-2.5', taskType: 'video', priceKind: 'unset' as const };
    const rule = ruleFromForm(form, TOKEN_RULE);

    expect(rule.basePrice).toEqual({ kind: 'unset', by: ['video'] });
    expect(rule.basePrice).not.toHaveProperty('table');
    expect(rule.basePrice).not.toHaveProperty('value');
  });

  it('★ 待配状态不校验价格栏（空位就是「没填」这个状态本身）', () => {
    const form = {
      ...emptyRuleForm(),
      modelId: 'm',
      taskType: 'video',
      priceKind: 'unset' as const,
      priceTable: [],
    };

    expect(ruleFormError(form)).toBeNull();
  });

  it('基准维度候选里不再有 usage.c（视频不再按 token 计价）', () => {
    expect(BASE_UNIT_OPTIONS.map((o) => o.value)).not.toContain('usage.c');
  });

});
