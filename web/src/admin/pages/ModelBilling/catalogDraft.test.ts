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

describe('单位换算（只用于展示）', () => {
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

  it('万分比 → 倍数', () => {
    expect(bpToMultiple(4000)).toBe(0.4);
    expect(bpToMultiple(12000)).toBe(1.2);
  });

  it('人类可读的单价：积分与元都给出，元的换算不了就只给积分', () => {
    expect(describePriceInHuman(100000, 15)).toBe('100 积分 ≈ ¥6.67');
    expect(describePriceInHuman(100000, null)).toBe('100 积分');
  });
});

describe('ruleFormError（只拦表单表达不出来的东西）', () => {
  const form = (patch: Partial<RuleForm> = {}): RuleForm => ({
    ...emptyRuleForm(),
    modelId: 'm',
    taskType: 't',
    priceValue: '1000',
    ...patch,
  });

  it('模型 / 任务类型 / 基准维度不能空', () => {
    expect(ruleFormError(form({ modelId: ' ' }))).toBe('模型 ID 必填');
    expect(ruleFormError(form({ taskType: '' }))).toBe('任务类型必填');
    expect(ruleFormError(form({ baseUnit: '' }))).toBe('基准维度必填');
  });

  it('常数单价必须是整数 mc', () => {
    expect(ruleFormError(form({ priceValue: '' }))).toBe('基准单价必填，且是整数 mc');
    expect(ruleFormError(form({ priceValue: '1.5' }))).toBe('基准单价必填，且是整数 mc');
    expect(ruleFormError(form({ priceValue: '-1' }))).toBe('基准单价必填，且是整数 mc');
    expect(ruleFormError(form({ priceValue: '1000' }))).toBeNull();
  });

  it('查表方式至少要有一行，且键不能空', () => {
    expect(ruleFormError(form({ priceKind: 'table', priceTable: [] }))).toBe(
      '价格表至少要有一行（规格键 → 单价 mc）',
    );
    expect(
      ruleFormError(form({ priceKind: 'table', priceTable: [{ key: '', value: '100' }] })),
    ).toBe('价格表的键不能为空');
  });

  it('★ 常数方式下不看价格表：收起来那一栏里的空行不该拦住保存', () => {
    // emptyRuleForm 的价格表默认带一个空行（切到查表方式时直接能填）
    expect(ruleFormError(form())).toBeNull();
    expect(
      ruleFormError(form({ priceTable: [{ key: 'size=1k', value: '不是数字' }] })),
    ).toBeNull();
  });

  it('键值行：键不能空，值必须是整数', () => {
    expect(ruleFormError(form({ dims: [{ key: 'usage.seconds', value: 'abc' }] }))).toBe(
      '维度表「usage.seconds」的值必须是整数',
    );
    expect(ruleFormError(form({ dims: [{ key: 'usage.seconds', value: '4000' }] }))).toBeNull();
    expect(ruleFormError(form({ multipliers: [{ key: ' ', value: '1' }] }))).toBe(
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
    priceValue: '100000',
    unitDenominator: '1',
    minCredits: '1',
    maxCredits: '',
    ...patch,
  });

  it('常数单价：mc 原值写回，上限留空写 null（显式表达「不封顶」）', () => {
    const rule = ruleFromForm(form());

    expect(rule).toMatchObject({
      baseUnit: 'usage.seconds',
      basePrice: { kind: 'const', value: 100000 },
      unitDenominator: 1,
      minCredits: 1,
      maxCredits: null,
    });
  });

  it('不编辑的字段从原规则带过来（usageSemantic / by 不该被这次编辑抹掉）', () => {
    const rule = ruleFromForm(form(), {
      usageSemantic: 'openai',
      basePrice: { by: ['size'] },
    });

    expect(rule.usageSemantic).toBe('openai');
    expect(rule.basePrice).toEqual({ by: ['size'], kind: 'const', value: 100000 });
  });

  it('查表：table 与 kind 一起换，空 dims / multipliers 不写进文档', () => {
    const rule = ruleFromForm(
      form({
        priceKind: 'table',
        priceTable: [
          { key: 'size=1k', value: '100000' },
          { key: 'size=2k', value: '200000' },
        ],
      }),
    );

    expect(rule.basePrice).toMatchObject({
      kind: 'table',
      value: null,
      table: { 'size=1k': 100000, 'size=2k': 200000 },
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
      ),
    ).toThrow(/键重复/);
  });

  it('维度与倍率按万分比整数写入', () => {
    const rule = ruleFromForm(
      form({
        dims: [{ key: 'usage.succeededSlots', value: '4000' }],
        multipliers: [{ key: 'usage.referenceCount', value: '12000' }],
      }),
    );

    expect(rule.dims).toEqual({ 'usage.succeededSlots': 4000 });
    expect(rule.multipliers).toEqual({ 'usage.referenceCount': 12000 });
  });
});

describe('formFromRule → ruleFromForm 往返', () => {
  it('读出来再写回去，规则本身不变（编辑没碰过的字段不该被改写）', () => {
    const original = DOC.models['seedance-2.5'].text2video;

    const back = ruleFromForm(formFromRule('seedance-2.5', 'text2video', original), original);

    expect(back).toEqual(original);
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

  it('★ 读出来再写回去，tokenEstimate 与「单价待配」都原样保留（往返无损）', () => {
    // 查表规则：`value: null` 是本页既有的显式写法（见「查表：table 与 kind 一起换」那条），
    // 所以这里按字段断言，不拿整份对象逐字比
    const tableBack = ruleFromForm(formFromRule('seedance-2.0', 'video', TOKEN_RULE), TOKEN_RULE);
    expect(tableBack).toMatchObject(TOKEN_RULE);
    expect(tableBack.tokenEstimate).toEqual(TOKEN_RULE.tokenEstimate);

    // 待配规则不带任何价 —— 往返必须**逐字**相同（它是要长期挂在目录里的那个空位）
    const unsetRule = { ...TOKEN_RULE, basePrice: { kind: 'unset', by: ['video'] } };
    expect(ruleFromForm(formFromRule('seedance-2.5', 'video', unsetRule), unsetRule)).toEqual(
      unsetRule,
    );
  });

  it('★ 计价方式选「单价待配」→ 写入 kind=unset，且**不带任何价**', () => {
    const form = { ...emptyRuleForm(), modelId: 'seedance-2.5', taskType: 'video', priceKind: 'unset' as const };
    const rule = ruleFromForm(form, TOKEN_RULE);

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

    expect(ruleFormError(form)).toBeNull();
  });

  it('★ 勾了 token 估算就必须把除数 / 帧率 / 尺寸表配全（半配会发布失败）', () => {
    const base: RuleForm = {
      ...emptyRuleForm(),
      modelId: 'm',
      taskType: 'video',
      baseUnit: 'usage.c',
      priceKind: 'table',
      priceTable: [{ key: 'video=0', value: '555000' }],
      tokenEstimateEnabled: true,
      tokenDimensions: [{ key: 'resolution=720p|aspect_ratio=16:9', value: '1248x704' }],
    };

    expect(ruleFormError(base)).toBeNull();
    expect(ruleFormError({ ...base, tokenDivisor: '' })).toContain('除数');
    expect(ruleFormError({ ...base, tokenFps: '0' })).toContain('帧率');
    expect(ruleFormError({ ...base, tokenDimensions: [] })).toContain('尺寸表');
    expect(
      ruleFormError({ ...base, tokenDimensions: [{ key: '', value: '1248x704' }] }),
    ).toContain('规格键');
    expect(
      ruleFormError({ ...base, tokenDimensions: [{ key: 'resolution=720p', value: '' }] }),
    ).toContain('宽高');
  });

  it('★ 取消勾选 → tokenEstimate 整块删掉（不留半配的残骸，那会发布失败）', () => {
    const form = { ...formFromRule('m', 'video', TOKEN_RULE), tokenEstimateEnabled: false };
    const rule = ruleFromForm(form, TOKEN_RULE);

    expect(rule).not.toHaveProperty('tokenEstimate');
  });

  it('★ 清空输入时长键 → 明确不要那一项（不能因为原文档里有就留着）', () => {
    const form = { ...formFromRule('m', 'video', TOKEN_RULE), tokenInputSecondsKey: '  ' };
    const rule = ruleFromForm(form, TOKEN_RULE);

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

    expect(ruleFormError(form)).toBeNull();
    expect(ruleFromForm(form).tokenEstimate?.dimensions).toEqual({
      'resolution=1080p|aspect_ratio=16:9': '1920x1088',
    });
  });

  it('基准维度候选里有 usage.c（否则界面根本选不出「按 token 计价」）', () => {
    expect(BASE_UNIT_OPTIONS.map((o) => o.value)).toContain('usage.c');
  });

  it('规格键的人话只加解释、不改键名', () => {
    expect(describeSpecKey('video=0')).toBe('video=0（不含视频输入 video0）');
    expect(describeSpecKey('video=1')).toBe('video=1（含视频输入 video1）');
    expect(describeSpecKey('size=2k')).toBe('size=2k');
  });

  it('单价待配在表格里显示为「提交会被拒绝」，不是「0 或 —」', () => {
    expect(describeBasePrice({ basePrice: { kind: 'unset' } })).toBe('单价未配（提交会被拒绝）');
  });
});
