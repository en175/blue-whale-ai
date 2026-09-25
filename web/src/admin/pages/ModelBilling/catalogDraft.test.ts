import { describe, expect, it } from 'vitest';
import {
  BASE_UNIT_OPTIONS,
  bpToMultiple,
  describeBasePrice,
  describePriceInHuman,
  describeSpecKey,
  emptyCatalog,
  formFromRule,
  isCatalogDirty,
  listRules,
  mcToCredits,
  mcToYuan,
  mcToYuanText,
  priceUnitLabel,
  yuanDecimals,
  yuanToMc,
  parseCatalog,
  readCreditsPerYuan,
  readDiscountPolicy,
  ruleFormError,
  ruleFromForm,
  serializeCatalog,
  withCreditsPerYuan,
  withDiscountPolicy,
  withRule,
  withoutRule,
  emptyRuleForm,
  type RuleForm,
} from './catalogDraft';

/** 一份带「本页不认识的字段」的目录：那正是最容易被一次编辑悄悄抹掉的东西。 */
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

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('parseCatalog', () => {
  it('空文本 → 一份能编译过的骨架（「还没有生效目录」时从零起草）', () => {
    const doc = parseCatalog('');

    expect(doc.schemaVersion).toBe(1);
    expect(doc.creditsPerYuan).toBe(15);
    expect(doc.models).toEqual({});
  });

  it('不是合法 JSON → 抛中文错误（这句话要直接给用户看）', () => {
    expect(() => parseCatalog('{ 不是 json')).toThrow(/不是合法 JSON/);
  });

  it('合法 JSON 但不是对象（数组）→ 拒绝', () => {
    expect(() => parseCatalog('[1,2,3]')).toThrow(/必须是 JSON 对象/);
  });
});

describe('改文档不碰不认识的字段', () => {
  it('改一条规则后，顶层与规则里的未知字段都还在', () => {
    const next = withRule(DOC, 'seedance-2.5', 'text2video', {
      ...DOC.models['seedance-2.5'].text2video,
      basePrice: { kind: 'const', value: 200000 },
    });

    expect(next.futureFlag).toBe('别删我');
    const rule = (next.models as typeof DOC.models)['seedance-2.5'].text2video;
    expect(rule.futureRuleField).toBe(true);
    // 该改的确实改了
    expect((rule.basePrice as { value: number }).value).toBe(200000);
  });

  it('新增规则不会动已有规则，也不改入参（页面拿它当 state）', () => {
    const next = withRule(DOC, '新模型', 'text2image', { baseUnit: 'constant:1' });

    expect(Object.keys(next.models as object).sort()).toEqual(['seedance-2.5', '新模型']);
    // 原对象一个字节没变 —— 变了的话 React 的脏检查会失真
    expect(DOC.models['seedance-2.5'].text2video.baseUnit).toBe('usage.seconds');
    expect(Object.keys(DOC.models)).toEqual(['seedance-2.5']);
  });

  it('删掉一条规则：模型下没有其他任务时，连模型键一起清掉', () => {
    const next = withoutRule(DOC, 'seedance-2.5', 'text2video');

    expect(next.models).toEqual({});
    expect(parseCatalog(serializeCatalog(next)).models).toEqual({});
  });

  it('删掉某个模型下的一条任务，同模型的其他任务留着', () => {
    const two = withRule(DOC, 'seedance-2.5', 'text2image', { baseUnit: 'constant:1' });

    const next = withoutRule(two, 'seedance-2.5', 'text2video');

    expect(Object.keys((next.models as Record<string, object>)['seedance-2.5'])).toEqual([
      'text2image',
    ]);
  });

  it('换算率可以清空成 null（不替人补默认值）', () => {
    const next = withCreditsPerYuan(DOC, null);

    expect(readCreditsPerYuan(next)).toBeNull();
    // 写进 JSON 是 null：发布时 billing 会明确拒绝，而不是这里悄悄填个 15
    expect(serializeCatalog(next)).toContain('"creditsPerYuan":null');
  });

  it('折扣策略只改给的字段（stackMode 不动 floorFactorBp）', () => {
    const next = withDiscountPolicy(DOC, { floorFactorBp: 5000 });

    expect(readDiscountPolicy(next)).toEqual({ stackMode: 'multiply', floorFactorBp: 5000 });
  });
});

describe('isCatalogDirty', () => {
  it('★ 原样写回同一个值不算改动（否则点一次保存就多一个内容相同的版本）', () => {
    const edited = withRule(DOC, 'seedance-2.5', 'text2video', {
      ...DOC.models['seedance-2.5'].text2video,
    });

    expect(isCatalogDirty(edited, DOC)).toBe(false);
  });

  it('真的改了 → 算改动', () => {
    expect(isCatalogDirty(withCreditsPerYuan(DOC, 20), DOC)).toBe(true);
    expect(isCatalogDirty(withoutRule(DOC, 'seedance-2.5', 'text2video'), DOC)).toBe(true);
  });

  it('改完又改回去 → 不算改动', () => {
    const back = withCreditsPerYuan(withCreditsPerYuan(DOC, 20), 15);

    expect(isCatalogDirty(back, DOC)).toBe(false);
  });
});

describe('listRules', () => {
  it('摊平成 (模型, 任务类型) 行并按名字排序（展示顺序不随 JSON 键序漂）', () => {
    const doc = withRule(withRule(DOC, 'a-model', 't', {}), 'a-model', 'a', {});

    expect(listRules(doc).map((r) => `${r.modelId}/${r.taskType}`)).toEqual([
      'a-model/a',
      'a-model/t',
      'seedance-2.5/text2video',
    ]);
  });

  it('models 缺失或不是对象时不炸（老文档、手工写的文档）', () => {
    expect(listRules({ models: null })).toEqual([]);
    expect(listRules({})).toEqual([]);
  });
});

describe('单位换算', () => {
  it('mc → 积分按四舍五入（与 billing 的 halfUp 同口径）', () => {
    expect(mcToCredits(100000)).toBe(100);
    expect(mcToCredits(500)).toBe(1);
    expect(mcToCredits(499)).toBe(0);
  });

  it('mc → 元', () => {
    expect(mcToYuan(15000, 15)).toBeCloseTo(1);
    expect(mcToYuan(100000, 15)).toBeCloseTo(6.6666666, 6);
    // 没有生效目录（换算率取不到）时给不出元，不猜
    expect(mcToYuan(100000, null)).toBeNull();
    expect(mcToYuan(100000, 0)).toBeNull();
  });

  it('元 → mc：官方价目表的元配上 unitDenominator 就是目录里的 mc', () => {
    // 视频：元 / 百万 token（unitDenominator=1000000）
    expect(yuanToMc(70, 15)).toBe(1050000);
    expect(yuanToMc(42, 15)).toBe(630000);
    expect(yuanToMc(77, 15)).toBe(1155000);
    expect(yuanToMc(46, 15)).toBe(690000);
    // 图片：元 / 张（unitDenominator=1）—— 小数报价同样要收
    expect(yuanToMc(0.12, 15)).toBe(1800);
    // 换算率取不到 ⇒ null，而不是拿 mc 冒充元
    expect(yuanToMc(70, null)).toBeNull();
    expect(yuanToMc(70, 0)).toBeNull();
  });

  it('★ 硬不变式：mc → 元文本 → 换回 mc 必须逐位相等（否则「打开→保存」会把价挪走）', () => {
    // 覆盖整数元、除不尽的元（100000 mc = ¥6.666666…）、以及 1 mc 这种极小值
    const samples = [
      1, 2, 499, 500, 1000, 1800, 10000, 15000, 33333, 100000, 420000, 555000, 690000,
      765000, 1050000, 1155000, 999999, 1234567,
    ];
    for (const mc of samples) {
      const text = mcToYuanText(mc, 15);
      expect(yuanToMc(Number(text), 15), `mc=${mc} → ${text}`).toBe(mc);
    }
  });

  it('★ 换算率越大，元文本的小数位越多（位数不够就会漂）', () => {
    // 位数按 0.5×10⁻ᵈ×creditsPerYuan×1000 < 0.5 推出来：d > log10(creditsPerYuan)+3
    expect(yuanDecimals(15)).toBe(6);
    expect(yuanDecimals(100000)).toBeGreaterThanOrEqual(9);
    for (const cpy of [1, 15, 100, 100000]) {
      const text = mcToYuanText(765000, cpy);
      expect(yuanToMc(Number(text), cpy), `cpy=${cpy} → ${text}`).toBe(765000);
    }
  });

  it('元文本去掉尾随 0：整数元显示成 70，不是 70.000000', () => {
    expect(mcToYuanText(1050000, 15)).toBe('70');
    expect(mcToYuanText(630000, 15)).toBe('42');
    expect(mcToYuanText(1800, 15)).toBe('0.12');
    // 没有换算率时给空串 —— 不拿 mc 冒充元
    expect(mcToYuanText(1050000, null)).toBe('');
  });

  it('万分比 → 倍数', () => {
    expect(bpToMultiple(4000)).toBe(0.4);
    expect(bpToMultiple(12000)).toBe(1.2);
  });

  it('人类可读的单价：元在前（运营认的就是元），积分放括号里', () => {
    expect(describePriceInHuman(1050000, 15, '百万 token')).toBe('70 元 / 百万 token（1050 积分）');
    expect(describePriceInHuman(1050000, 15)).toBe('70 元（1050 积分）');
    // 换算不了就只给积分 —— 不编一个元出来
    expect(describePriceInHuman(100000, null)).toBe('100 积分');
  });

  it('单价的量纲由 unitDenominator + baseUnit 一起决定（70 是每百万 token，0.12 是每张）', () => {
    expect(priceUnitLabel({ baseUnit: 'usage.c', unitDenominator: 1000000 })).toBe('百万 token');
    expect(priceUnitLabel({ baseUnit: 'constant:1', unitDenominator: 1 })).toBe('次');
    expect(priceUnitLabel({ baseUnit: 'usage.succeededSlots', unitDenominator: 1 })).toBe('张');
    expect(priceUnitLabel({ baseUnit: 'usage.seconds', unitDenominator: 1 })).toBe('秒');
  });
});

describe('ruleFormError（只拦表单表达不出来的东西）', () => {
  /** 价格栏填的是**元**（见 MoneyField），所以这里给的都是元。 */
  const form = (patch: Partial<RuleForm> = {}): RuleForm => ({
    ...emptyRuleForm(),
    modelId: 'm',
    taskType: 't',
    priceValue: { value: '70', originalMc: null },
    ...patch,
  });

  it('模型 / 任务类型 / 基准维度不能空', () => {
    expect(ruleFormError(form({ modelId: ' ' }), 15)).toBe('模型 ID 必填');
    expect(ruleFormError(form({ taskType: '' }), 15)).toBe('任务类型必填');
    expect(ruleFormError(form({ baseUnit: '' }), 15)).toBe('基准维度必填');
  });

  it('常数单价必须是数（元；整数报价与小数报价都收）', () => {
    expect(ruleFormError(form({ priceValue: { value: '', originalMc: null } }), 15)).toBe(
      '基准单价必填，且是一个数（单位：元 / 每 unitDenominator 个单位，如 70）',
    );
    expect(ruleFormError(form({ priceValue: { value: '不是数', originalMc: null } }), 15)).toBe(
      '基准单价必填，且是一个数（单位：元 / 每 unitDenominator 个单位，如 70）',
    );
    expect(ruleFormError(form({ priceValue: { value: '-1', originalMc: null } }), 15)).toContain(
      '基准单价必填',
    );
    expect(ruleFormError(form({ priceValue: { value: '70', originalMc: null } }), 15)).toBeNull();
    expect(ruleFormError(form({ priceValue: { value: '0.12', originalMc: null } }), 15)).toBeNull();
  });

  it('★ 读不到换算率就拦下来：单价按元填、要换回 mc，换算率缺了写回去的只能是错的', () => {
    expect(ruleFormError(form(), null)).toContain('读不到换算率');
    expect(ruleFormError(form({ priceKind: 'table' }), null)).toContain('读不到换算率');
    // 单价待配不写任何价 ⇒ 不需要换算率
    expect(ruleFormError(form({ priceKind: 'unset' }), null)).toBeNull();
  });

  it('查表方式至少要有一行，且键不能空', () => {
    expect(ruleFormError(form({ priceKind: 'table', priceTable: [] }), 15)).toBe(
      '价格表至少要有一行（规格键 → 单价）',
    );
    expect(
      ruleFormError(
        form({ priceKind: 'table', priceTable: [{ key: '', value: '10', originalMc: null }] }),
        15,
      ),
    ).toBe('价格表的键不能为空');
  });

  it('★ 常数方式下不看价格表：收起来那一栏里的空行不该拦住保存', () => {
    // emptyRuleForm 的价格表默认带一个空行（切到查表方式时直接能填）
    expect(ruleFormError(form(), 15)).toBeNull();
    expect(
      ruleFormError(
        form({ priceTable: [{ key: 'size=1k', value: '不是数字', originalMc: null }] }),
        15,
      ),
    ).toBeNull();
  });

  it('键值行：键不能空，值必须是整数', () => {
    expect(ruleFormError(form({ dims: [{ key: 'usage.seconds', value: 'abc' }] }), 15)).toBe(
      '维度表「usage.seconds」的值必须是整数',
    );
    expect(
      ruleFormError(form({ dims: [{ key: 'usage.seconds', value: '4000' }] }), 15),
    ).toBeNull();
    expect(ruleFormError(form({ multipliers: [{ key: ' ', value: '1' }] }), 15)).toBe(
      '维度表的键不能为空',
    );
  });

  it('单位分母 / 上下限留空可以，填了就必须是整数', () => {
    expect(ruleFormError(form({ unitDenominator: '' }), 15)).toBeNull();
    expect(ruleFormError(form({ unitDenominator: 'x' }), 15)).toContain('单位分母必须是整数');
    expect(ruleFormError(form({ maxCredits: '' }), 15)).toBeNull();
    expect(ruleFormError(form({ maxCredits: '2.5' }), 15)).toContain('积分上限必须是整数');
  });
});

describe('ruleFromForm', () => {
  /** 价格栏填的是**元**；`originalMc` 是打开表单时读到的原值（未改动时原样写回）。 */
  const form = (patch: Partial<RuleForm> = {}): RuleForm => ({
    ...emptyRuleForm(),
    modelId: 'm',
    taskType: 't',
    baseUnit: 'usage.seconds',
    priceValue: { value: '6.666667', originalMc: 100000 },
    unitDenominator: '1',
    minCredits: '1',
    maxCredits: '',
    ...patch,
  });

  it('常数单价：原 mc 写回，上限留空写 null（显式表达「不封顶」）', () => {
    const rule = ruleFromForm(form(), {}, 15);

    expect(rule).toMatchObject({
      baseUnit: 'usage.seconds',
      basePrice: { kind: 'const', value: 100000 },
      unitDenominator: 1,
      minCredits: 1,
      maxCredits: null,
    });
  });

  it('★ 换算率算出来的元文本原样写回时，用的是**目录里的原 mc**（一位不差）', () => {
    // 100000 mc 在 creditsPerYuan=15 下是 ¥6.666666…：只按文本换算会漂，
    // 这里必须命中「没改过 ⇒ 原值写回」那条分支
    const unchanged = form({ priceValue: { value: mcToYuanText(100000, 15), originalMc: 100000 } });
    expect(ruleFromForm(unchanged, {}, 15).basePrice).toMatchObject({ value: 100000 });

    // 真把它改成 70 元 ⇒ 才换算成 1050000
    const edited = form({ priceValue: { value: '70', originalMc: 100000 } });
    expect(ruleFromForm(edited, {}, 15).basePrice).toMatchObject({ value: 1050000 });
  });

  it('不编辑的字段从原规则带过来（usageSemantic / by 不该被这次编辑抹掉）', () => {
    const rule = ruleFromForm(
      form(),
      {
        usageSemantic: 'openai',
        basePrice: { by: ['size'] },
      },
      15,
    );

    expect(rule.usageSemantic).toBe('openai');
    expect(rule.basePrice).toEqual({ by: ['size'], kind: 'const', value: 100000 });
  });

  it('查表：table 与 kind 一起换，空 dims / multipliers 不写进目录', () => {
    const rule = ruleFromForm(
      form({
        priceKind: 'table',
        priceTable: [
          { key: 'size=1k', value: '70', originalMc: null },
          { key: 'size=2k', value: '6.666667', originalMc: 100000 },
        ],
      }),
      {},
      15,
    );

    expect(rule.basePrice).toMatchObject({
      kind: 'table',
      value: null,
      // 1k 是新填的（70 元 → 1050000），2k 没改（原值 100000 写回）
      table: { 'size=1k': 1050000, 'size=2k': 100000 },
    });
    expect(rule).not.toHaveProperty('dims');
    expect(rule).not.toHaveProperty('multipliers');
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
        15,
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
        15,
      ),
    ).toThrow(/键重复/);
  });

  it('维度与倍率按万分比整数写入', () => {
    const rule = ruleFromForm(
      form({
        dims: [{ key: 'usage.succeededSlots', value: '4000' }],
        multipliers: [{ key: 'usage.referenceCount', value: '12000' }],
      }),
      {},
      15,
    );

    expect(rule.dims).toEqual({ 'usage.succeededSlots': 4000 });
    expect(rule.multipliers).toEqual({ 'usage.referenceCount': 12000 });
  });
});

describe('formFromRule → ruleFromForm 往返', () => {
  it('读出来再写回去，规则本身不变（编辑没碰过的字段不该被改写）', () => {
    const original = DOC.models['seedance-2.5'].text2video;

    const back = ruleFromForm(
      formFromRule('seedance-2.5', 'text2video', original, 15),
      original,
      15,
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
          // 除不尽的那种价也要原样活着回去
          'resolution=720p|video=0': 33333,
          'resolution=720p|video=1': 1,
        },
      },
      unitDenominator: 1000000,
      minCredits: 1,
      maxCredits: null,
      rounding: 'halfUp',
    };

    const back = ruleFromForm(formFromRule('m', 'video', rule, 15), rule, 15);

    // `value: null` 是查表形态的显式写法（见「查表：table 与 kind 一起换」那条），
    // 所以这里逐位比的是**每一档价**
    expect(back.basePrice).toMatchObject({ kind: 'table', table: rule.basePrice.table });
  });

  it('空规则给出一份能直接编辑的默认表单', () => {
    const form = formFromRule('m', 't', {}, 15);

    expect(form).toMatchObject({
      baseUnit: '',
      priceKind: 'const',
      unitDenominator: '1',
      minCredits: '1',
      rounding: 'halfUp',
    });
  });
});

describe('emptyCatalog', () => {
  it('骨架里有 schemaVersion / currency / models / discountPolicy', () => {
    expect(emptyCatalog(15)).toEqual({
      schemaVersion: 1,
      currency: 'CNY',
      creditsPerYuan: 15,
      models: {},
      discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
    });
  });

  it('克隆出来的是新对象（页面拿它当草稿，不该与常量共享引用）', () => {
    const a = clone(DOC);
    expect(withCreditsPerYuan(a, 20)).not.toBe(a);
  });
});

/* ── token 计费（视频按 token）与「单价待配」空位 ───────────────────────────
 * 这一组钉的是「用户要的那个地方」：单价、token 估算参数、尺寸表都能在管理端改，
 * 而「还没填」是一个**显式的空位**（unset），不是「按 0 免费」。 */
describe('token 计价的规则编辑', () => {
  /** 一条视频按 token 计价的规则（2.0 的形态：查表单价 + token 估算参数）。 */
  const TOKEN_RULE = {
    baseUnit: 'usage.c',
    basePrice: { kind: 'table', by: ['video'], table: { 'video=0': 555000, 'video=1': 330000 } },
    unitDenominator: 1000000,
    minCredits: 1,
    maxCredits: null,
    rounding: 'halfUp',
    tokenEstimate: {
      divisor: 1024,
      fps: 24,
      inputSecondsKey: 'video_input_seconds',
      dimensions: { 'resolution=720p|aspect_ratio=16:9': '1248x704' },
    },
  };

  it('★ 读出来再写回去，tokenEstimate 与价格表都原样保留（往返无损）', () => {
    const tableBack = ruleFromForm(
      formFromRule('seedance-2.0', 'video', TOKEN_RULE, 15),
      TOKEN_RULE,
      15,
    );
    expect(tableBack).toMatchObject(TOKEN_RULE);
    expect(tableBack.tokenEstimate).toEqual(TOKEN_RULE.tokenEstimate);
    // 价也要一位不差：330000 mc = ¥22，换算回 mc 必须还是 330000
    expect(tableBack.basePrice).toMatchObject({ table: TOKEN_RULE.basePrice.table });

    // 待配规则不带任何价 —— 往返必须**逐字**相同（它是要长期挂在目录里的那个空位）
    const unsetRule = { ...TOKEN_RULE, basePrice: { kind: 'unset', by: ['video'] } };
    expect(
      ruleFromForm(formFromRule('seedance-2.5', 'video', unsetRule, 15), unsetRule, 15),
    ).toEqual(unsetRule);
  });

  it('★ 计价方式选「单价待配」→ 写入 kind=unset，且**不带任何价**', () => {
    const form = { ...emptyRuleForm(), modelId: 'seedance-2.5', taskType: 'video', priceKind: 'unset' as const };
    const rule = ruleFromForm(form, TOKEN_RULE, 15);

    expect(rule.basePrice).toEqual({ kind: 'unset', by: ['video'] });
    // ⚠️ 上一版的 table 必须清掉：留着会让人以为「价还在，只是待配」，而 billing 那边是必拒的
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

    expect(ruleFormError(form, 15)).toBeNull();
  });

  it('★ 勾了 token 估算就必须把除数 / 帧率 / 尺寸表配全（半配会发布失败）', () => {
    const base: RuleForm = {
      ...emptyRuleForm(),
      modelId: 'm',
      taskType: 'video',
      baseUnit: 'usage.c',
      priceKind: 'table',
      priceTable: [{ key: 'resolution=720p|video=0', value: '37', originalMc: null }],
      tokenEstimateEnabled: true,
      tokenDimensions: [{ key: 'resolution=720p|aspect_ratio=16:9', value: '1248x704' }],
    };

    expect(ruleFormError(base, 15)).toBeNull();
    expect(ruleFormError({ ...base, tokenDivisor: '' }, 15)).toContain('除数');
    expect(ruleFormError({ ...base, tokenFps: '0' }, 15)).toContain('帧率');
    expect(ruleFormError({ ...base, tokenDimensions: [] }, 15)).toContain('尺寸表');
    expect(
      ruleFormError({ ...base, tokenDimensions: [{ key: '', value: '1248x704' }] }, 15),
    ).toContain('规格键');
    expect(
      ruleFormError({ ...base, tokenDimensions: [{ key: 'resolution=720p', value: '' }] }, 15),
    ).toContain('宽高');
  });

  it('★ 取消勾选 → tokenEstimate 整块删掉（不留半配的残骸，那会发布失败）', () => {
    const form = { ...formFromRule('m', 'video', TOKEN_RULE, 15), tokenEstimateEnabled: false };
    const rule = ruleFromForm(form, TOKEN_RULE, 15);

    expect(rule).not.toHaveProperty('tokenEstimate');
  });

  it('★ 清空输入时长键 → 明确不要那一项（不能因为原文档里有就留着）', () => {
    const form = { ...formFromRule('m', 'video', TOKEN_RULE, 15), tokenInputSecondsKey: '  ' };
    const rule = ruleFromForm(form, TOKEN_RULE, 15);

    expect(rule.tokenEstimate).not.toHaveProperty('inputSecondsKey');
    expect(rule.tokenEstimate?.divisor).toBe(1024);
  });

  it('尺寸表的值是文本（1248x704），不是数字 —— 不能被数字校验拦下', () => {
    const form = {
      ...emptyRuleForm(),
      modelId: 'm',
      taskType: 'video',
      // 单价另说：这条只验尺寸表的值形态，所以把价格留成空位
      priceKind: 'unset' as const,
      tokenEstimateEnabled: true,
      tokenDimensions: [{ key: 'resolution=1080p|aspect_ratio=16:9', value: '1920x1088' }],
    };

    expect(ruleFormError(form, 15)).toBeNull();
    expect(ruleFromForm(form, {}, 15).tokenEstimate?.dimensions).toEqual({
      'resolution=1080p|aspect_ratio=16:9': '1920x1088',
    });
  });

  it('基准维度候选里有 usage.c（否则界面根本选不出「按 token 计价」）', () => {
    expect(BASE_UNIT_OPTIONS.map((o) => o.value)).toContain('usage.c');
  });

  it('规格键的人话只加解释、不改键名（复合键里的 video 那一段也认）', () => {
    expect(describeSpecKey('video=0')).toBe('video=0（不含视频输入 video0）');
    expect(describeSpecKey('video=1')).toBe('video=1（含视频输入 video1）');
    expect(describeSpecKey('size=2k')).toBe('size=2k');
    expect(describeSpecKey('resolution=1080p|video=1')).toBe(
      'resolution=1080p | video=1（含视频输入 video1）',
    );
  });

  it('单价待配在表格里显示为「提交会被拒绝」，不是「0 或 —」', () => {
    expect(describeBasePrice({ basePrice: { kind: 'unset' } }, 15)).toBe('单价未配（提交会被拒绝）');
  });

  it('常数单价在表格里按元显示，并标出量纲', () => {
    expect(
      describeBasePrice({ baseUnit: 'constant:1', unitDenominator: 1, basePrice: { kind: 'const', value: 30000 } }, 15),
    ).toBe('2 元 / 次');
    expect(
      describeBasePrice(
        { baseUnit: 'usage.c', unitDenominator: 1000000, basePrice: { kind: 'const', value: 1050000 } },
        15,
      ),
    ).toBe('70 元 / 百万 token');
  });
});
