/* ============================================
 * 规则编辑弹窗 —— 定价目录里**一条规则**的编辑面
 *
 * 从 index.tsx 拆出来（那一页已经很长）：弹窗与页面之间只有一个 `onSave` 的接口，
 * 拆开之后「页面怎么展示目录」与「一条规则怎么编辑」各自独立。
 *
 * ── 这一面要同时说清三件事 ────────────────────────────────────────────────────
 *
 * 1. **单价按「元」填**（官方价目表的单位：元 / 百万 token、元 / 张、元 / 次），
 *    写回目录的是 mc —— 换算在 `catalogDraft` 里，理由见那边的文件头第 2 条；
 * 2. **不编辑的字段原样带回去**（`usageSemantic` / `by` 等，见 `ruleFromForm` 的入参 `original`）；
 * 3. **「单价待配」（unset）是显式的空位**，不是「先不收费」——弹窗要把它说清楚，
 *    因为它是运营最可能误判的一处（详见下面那段 Alert 的文案）。
 *
 * ── 规格键不再手敲：候选集来自模型配置 ──────────────────────────────────────
 *
 * 用户口径：「模型尺寸表，模型配置里面有啊，不是在模型价格这而已」。所以价格表与尺寸表
 * 的**键**一律派生自能力行（`sizeCandidates.ts`），运营只填**数**（宽高 / 单价）。
 * 目录里有、能力行里没有的键会作为**孤儿行**标出来——那是两份配置已经漂了的证据，
 * 不能静默丢掉。读不到能力行时退回自由编辑并在界面上说明。
 * ============================================ */
import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import {
  BASE_UNIT_OPTIONS,
  describePriceInHuman,
  priceUnitLabel,
  ruleFormError,
  ruleFromForm,
  yuanToMc,
  type CatalogRuleView,
  type KeyValueRow,
  type RuleForm,
} from './catalogDraft';
import {
  filledKeyValueRows,
  filledPriceRows,
  planRows,
  type RowPlan,
} from './rowPlan';
import {
  configuredSizePixels,
  defaultAxesForBaseUnit,
  describePixels,
  dimensionTableCandidates,
  prefillDimensionValue,
  priceTableCandidates,
  sizeOfSpecKey,
  type ModelCapabilityView,
} from './sizeCandidates';
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, Select } from '../../ui';

const ROUNDING_OPTIONS = [
  { value: 'halfUp', label: 'halfUp（四舍五入，默认）' },
  { value: 'ceil', label: 'ceil（向上取整，偏向平台）' },
  { value: 'floor', label: 'floor（向下取整，偏向用户）' },
];

/** 编辑弹窗要用的初始状态。 */
export interface RuleEditorState {
  initial: RuleForm;
  /** 改动前的那条规则：本页不编辑的字段（usageSemantic / by）从它原样带过去 */
  original: CatalogRuleView;
  /** 已有规则不能改键：模型 / 任务类型是 models 映射的键，改键等于挪位置 */
  isNew: boolean;
}

/* ============ 规则编辑弹窗 ============ */

export default function RuleEditorModal({
  state,
  creditsPerYuan,
  capabilityIndex,
  onClose,
  onSave,
}: {
  state: RuleEditorState;
  creditsPerYuan: number | null;
  /**
   * 模型配置（能力行）索引；`null` = 还没读到（或读取失败）。
   *
   * <p>按 `form.modelId` 现查而不是在打开弹窗时查一次：**新建**规则的模型 ID 正是在这个
   * 弹窗里填的，打开时还没有值。它只用来**派生候选规格键**，不参与钱的换算。
   */
  capabilityIndex: Map<string, ModelCapabilityView> | null;
  onClose: () => void;
  /** 回传组装好的规则，以及它在目录里的两个键（模型 / 任务类型） */
  onSave: (rule: CatalogRuleView, modelId: string, taskType: string) => void;
}) {
  const [form, setForm] = useState<RuleForm>(state.initial);
  const [error, setError] = useState('');
  const patch = (next: Partial<RuleForm>) => setForm((f) => ({ ...f, ...next }));

  /** 这个模型的能力行（模型配置）。拿不到就是 `null` —— 界面退回手工填键（见 `SpecRowEditor`）。 */
  const capability = useMemo(
    () => capabilityIndex?.get(form.modelId.trim()) ?? null,
    [capabilityIndex, form.modelId],
  );

  /** 基准维度可能是目录里的老值（新维度、文本类维度）：不在候选里就补一条，别显示成空白 */
  const baseUnitOptions = BASE_UNIT_OPTIONS.some((o) => o.value === form.baseUnit)
    ? BASE_UNIT_OPTIONS
    : [...BASE_UNIT_OPTIONS, { value: form.baseUnit, label: `${form.baseUnit}（目录里的现值）` }];

  /** 单价栏的量纲（「百万 token」/「次」/「张」）：表单里还没保存，直接从当前编辑值推 */
  const unitLabel = priceUnitLabel({
    baseUnit: form.baseUnit,
    unitDenominator: Number(form.unitDenominator.trim() || '1'),
  });

  /* ── 规格键的候选集：来自模型配置（见 sizeCandidates.ts 的文件头） ───────────── */

  /**
   * 价格表的定价轴。规则已经存进目录的，以它自己声明的 `basePrice.by` 为准
   * （那是目录里的事实）；新建规则（还没有 by）按基准维度给一个初值。
   */
  const priceAxes = useMemo(() => {
    const declared = state.original.basePrice?.by;
    if (Array.isArray(declared)) {
      const names = declared
        .filter((axis): axis is string => typeof axis === 'string' && axis.trim().length > 0)
        .map((axis) => axis.trim());
      if (names.length) return names;
    }
    return defaultAxesForBaseUnit(form.baseUnit);
  }, [state.original.basePrice, form.baseUnit]);

  const originalPriceKeys = useMemo(
    () => Object.keys(state.original.basePrice?.table ?? {}),
    [state.original.basePrice],
  );

  /** `null` = 派生不出来（读不到能力行 / 轴取不到取值）→ 退回自由编辑 */
  const priceCandidates = useMemo(
    () =>
      capability === null ? null : priceTableCandidates(capability, priceAxes, originalPriceKeys),
    [capability, priceAxes, originalPriceKeys],
  );

  /** 尺寸表恒为「分辨率档 × 宽高比」两轴；值全部来自能力行 */
  const dimensionCandidates = useMemo(
    () => (capability === null ? null : dimensionTableCandidates(capability)),
    [capability],
  );

  const pricePlan = useMemo(
    () =>
      planRows(form.priceTable, priceCandidates, (key) => ({ key, value: '', originalMc: null })),
    [form.priceTable, priceCandidates],
  );

  const dimensionPlan = useMemo(
    () =>
      planRows(form.tokenDimensions, dimensionCandidates, (key) => ({
        key,
        // 能力行里已经有这一格宽高就预填（图片矩阵）；视频没有，留空给运营填
        value: capability === null ? '' : prefillDimensionValue(capability, key),
      })),
    [form.tokenDimensions, dimensionCandidates, capability],
  );

  const priceYuan = form.priceValue.value.trim();
  const priceMc = priceYuan === '' ? null : yuanToMc(Number(priceYuan), creditsPerYuan);
  const humanPrice =
    priceMc === null ? '' : describePriceInHuman(priceMc, creditsPerYuan, unitLabel);

  const submit = () => {
    const message = ruleFormError(form, creditsPerYuan);
    if (message !== null) {
      setError(message);
      return;
    }
    try {
      onSave(
        ruleFromForm(form, state.original, creditsPerYuan),
        form.modelId.trim(),
        form.taskType.trim(),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '规则不合法');
    }
  };

  return (
    <Modal
      open
      title={state.isNew ? '新增计价规则' : `编辑 ${form.modelId} / ${form.taskType}`}
      width={780}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit}>
            确定
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
        <Field
          label="模型 ID"
          hint={
            state.isNew
              ? '能力表里的 model_id，例如 doubao-seedance-2-5-260628'
              : '已有规则的键不可改；要换模型请新增一条再删掉旧的'
          }
        >
          <Input
            aria-label="模型 ID"
            value={form.modelId}
            disabled={!state.isNew}
            onChange={(e) => patch({ modelId: e.target.value })}
          />
        </Field>
        <Field label="任务类型" hint="提交任务时的 type，例如 text2video / text2image">
          <Input
            aria-label="任务类型"
            value={form.taskType}
            disabled={!state.isNew}
            onChange={(e) => patch({ taskType: e.target.value })}
          />
        </Field>
        <Field label="基准维度" hint="按哪个用量维度计费；constant:1 = 按次">
          <Select
            aria-label="基准维度"
            options={baseUnitOptions}
            value={form.baseUnit}
            onChange={(baseUnit) => patch({ baseUnit })}
          />
        </Field>
        <Field label="计价方式" hint="常数单价、按规格查表，或「单价待配」留空">
          <Select
            aria-label="计价方式"
            options={[
              { value: 'const', label: 'const（常数单价）' },
              { value: 'table', label: 'table（按规格查表）' },
              { value: 'unset', label: 'unset（单价待配 —— 提交会被拒绝）' },
            ]}
            value={form.priceKind}
            onChange={(v) => {
              const kind = v === 'table' ? 'table' : v === 'unset' ? 'unset' : 'const';
              // ⚠️ 从「单价待配」切到「按规格查表」时价格表是**空的**（待配形态下不存价），
              //    空表连一行输入框都没有，人会以为界面坏了。补一行空行，与人新建规则时一致。
              //    这里补的不是价、也不猜档位键 —— 只是给一个能打字的地方。
              patch({
                priceKind: kind,
                ...(kind === 'table' && form.priceTable.length === 0
                  ? { priceTable: [{ key: '', value: '', originalMc: null }] }
                  : {}),
              });
            }}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        {form.priceKind === 'const' ? (
          <Field
            label={`基准单价（元 / ${unitLabel}）`}
            hint={humanPrice ? `当前 = ${humanPrice}` : '按目录里的换算率折成 mc 写回'}
          >
            <Input
              aria-label="基准单价"
              value={form.priceValue.value}
              placeholder="例如 70"
              onChange={(e) =>
                patch({ priceValue: { ...form.priceValue, value: e.target.value } })
              }
            />
          </Field>
        ) : form.priceKind === 'table' ? (
          <Field
            label={`价格表（规格键 → 单价，元 / ${unitLabel}）`}
            hint="档位候选来自**模型配置**（这个模型声明了哪些尺寸/比例档），这里只填价。没配到的档位组合提交会被拒绝（不会按 0 免费）"
          >
            <SpecRowEditor
              plan={pricePlan}
              derived={priceCandidates !== null}
              ariaPrefix="价格表"
              keyPlaceholder="resolution=720p|video=1"
              valuePlaceholder="70"
              capability={capability}
              makeRow={() => ({ key: '', value: '', originalMc: null })}
              onRows={(priceTable) =>
                patch({
                  priceTable: priceCandidates === null ? priceTable : filledPriceRows(priceTable),
                })
              }
            />
          </Field>
        ) : (
          <Alert tone="warning" title="单价还没填 —— 这个模型的提交会被拒绝">
            这条规则只留了个空位：基准维度、token 估算参数、单位分母都配好了，差的就是单价。
            在「单价待配」下提交任务是**直接失败**，不会按 0 免费生成（按 0 等于白送，
            而且账面上看不出来）。填好单价后把计价方式改成「按规格查表」或「常数单价」，再保存发布。
          </Alert>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '16px 24px',
          marginTop: 16,
        }}
      >
        <Field label="单位分母" hint="每多少个单位收这份单价：1 = 每秒/每张，1000000 = 每百万 token">
          <Input
            aria-label="单位分母"
            value={form.unitDenominator}
            onChange={(e) => patch({ unitDenominator: e.target.value })}
          />
        </Field>
        <Field label="积分下限" hint="算出来不足这个数就按下限收（整数积分）">
          <Input
            aria-label="积分下限"
            value={form.minCredits}
            onChange={(e) => patch({ minCredits: e.target.value })}
          />
        </Field>
        <Field label="积分上限" hint="留空 = 不封顶">
          <Input
            aria-label="积分上限"
            value={form.maxCredits}
            onChange={(e) => patch({ maxCredits: e.target.value })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Field
          label="舍入方式"
          hint="mc 换算成整数积分时怎么取整：ceil 时折扣要 ≥ 1 积分才看得出来"
        >
          <Select
            aria-label="舍入方式"
            options={ROUNDING_OPTIONS}
            value={form.rounding}
            onChange={(rounding) => patch({ rounding })}
          />
        </Field>
      </div>

      {/* ── token 预扣估算参数 ──────────────────────────────────────────────
          为什么单独一块：视频按 token 计价的规则**没有它就算不出预扣**
          （基准维度是 usage.c，而提交时刻没有真实 token），提交会被拒绝。
          而它是「预扣用什么公式」的参数，不是结算口径 —— 结算永远按上游返回的真值。 */}
      <div style={{ marginTop: 20, borderTop: '1px solid var(--bw-border, #e5e7eb)', paddingTop: 16 }}>
        <Checkbox
          checked={form.tokenEstimateEnabled}
          onChange={(tokenEstimateEnabled) => patch({ tokenEstimateEnabled })}
          label="按 token 估算预扣（基准维度是 usage.c 的规则需要勾）"
        />
        <div style={{ fontSize: 12, marginTop: 6, opacity: 0.75 }}>
          服务端按火山的官方公式（宽 × 高 × 帧率 × 时长 ÷ 除数）估一个 token 上限来冻结；
          结算仍按上游返回的真实 token 计价。不勾 = 这条规则不做估算 ——
          基准维度是 usage.c 而不勾，提交时会因「算不出契约量」被拒绝。
        </div>
      </div>

      {form.tokenEstimateEnabled && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '16px 24px',
              marginTop: 12,
            }}
          >
            <Field label="除数" hint="官方公式的除数字（火山对照表是 1024）">
              <Input
                aria-label="token 除数"
                value={form.tokenDivisor}
                onChange={(e) => patch({ tokenDivisor: e.target.value })}
              />
            </Field>
            <Field label="帧率" hint="官方对照表是 24；如实填，估低了预扣就冻少了">
              <Input
                aria-label="token 帧率"
                value={form.tokenFps}
                onChange={(e) => patch({ tokenFps: e.target.value })}
              />
            </Field>
            <Field
              label="输入时长的规格键（选填）"
              hint="填了公式就含「输入时长」那一项；留空 = 不含（含视频输入的任务预扣会偏低）"
            >
              <Input
                aria-label="输入时长的规格键"
                value={form.tokenInputSecondsKey}
                placeholder="video_input_seconds"
                onChange={(e) => patch({ tokenInputSecondsKey: e.target.value })}
              />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field
              label="尺寸表（规格键 → 宽x高）"
              hint="「有哪些档位 × 比例组合」来自**模型配置**（这个模型声明的分辨率档与宽高比），
                    这里只填宽高。官方表里没有的组合就是没配 —— 那时预扣推不出，提交会被拒绝"
            >
              <SpecRowEditor
                plan={dimensionPlan}
                derived={dimensionCandidates !== null}
                ariaPrefix="token 尺寸表"
                keyPlaceholder="resolution=720p|aspect_ratio=16:9"
                valuePlaceholder="1248x704"
                capability={capability}
                makeRow={() => ({ key: '', value: '' })}
                onRows={(tokenDimensions) =>
                  patch({
                    tokenDimensions:
                      dimensionCandidates === null
                        ? tokenDimensions
                        : filledKeyValueRows(tokenDimensions),
                  })
                }
              />
            </Field>
          </div>
          {/* ── 最低 token 用量（官方明文规则）────────────────────────────────
              火山：「当输入包含视频时，如果估算 token 用量 ＜ 最低 token 用量，
              则按最低 token 用量计算视频价格」。官方原页只给了两张表格的飞书链接，
              没有公开可抄的形态 —— 所以这是一块**留空即不做下限**的配置位。
              留空不是「还没配」，是一个明确的状态，界面上要说清楚。 */}
          <div style={{ marginTop: 12 }}>
            <Field
              label="最低 token 用量表（规格键 → 最低 token 数，选填）"
              hint="火山官方规则：**含视频输入时**，估算 token ＜ 这一格的下限 ⇒ 按下限计费。
                    键与价格表同一套语法，再带上输出时长（resolution=480p|aspect_ratio=16:9|duration=5）。
                    整块留空 = 本规则不做下限；配了就必须配全 —— 某格查不到时提交会被拒绝"
            >
              <KeyValueEditor
                rows={form.tokenMinimumTokens}
                ariaPrefix="最低 token 用量表"
                keyPlaceholder="resolution=480p|aspect_ratio=16:9|duration=5"
                valuePlaceholder="200000"
                makeRow={() => ({ key: '', value: '' })}
                onChange={(tokenMinimumTokens) => patch({ tokenMinimumTokens })}
              />
            </Field>
          </div>
        </>
      )}

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', marginTop: 16 }}
      >
        <Field label="附加维度（万分比）" hint="按用量加权：10000 = 1 倍，4000 = 0.4 倍。留空表示不加权">
          <KeyValueEditor
            rows={form.dims}
            ariaPrefix="附加维度"
            keyPlaceholder="usage.referenceCount"
            valuePlaceholder="4000"
            makeRow={() => ({ key: '', value: '' })}
            onChange={(dims) => patch({ dims })}
          />
        </Field>
        <Field label="整单倍率（万分比）" hint="整单连乘：12000 = 1.2 倍">
          <KeyValueEditor
            rows={form.multipliers}
            ariaPrefix="整单倍率"
            keyPlaceholder="usage.referenceCount"
            valuePlaceholder="12000"
            makeRow={() => ({ key: '', value: '' })}
            onChange={(multipliers) => patch({ multipliers })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Alert tone="info">
          单价按**元**填（官方价目表就是这个单位），保存时按目录里的换算率
          <b> 1 元 = {creditsPerYuan ?? '—'} 积分 </b>
          折成 mc 写回 —— 引擎与账本用的始终是 mc。
          <br />
          被改过的栏才重新换算：没动过的价**原值写回**，所以「打开看一眼、点保存」不会
          把价格挪动哪怕 1 mc。
        </Alert>
      </div>
    </Modal>
  );
}

/* ============ 规格表编辑器（价格表 / 尺寸表共用） ============
 *
 * 两种形态，由 `derived` 决定：
 *
 * - `derived`（读到了能力行）：**键是派生的只读文本**，只编辑值。候选集外的行作为
 *   「孤儿」标出来（那是两份配置漂了的证据），孤儿可以删 —— 但**不能新增**：要加档位
 *   去模型配置页加（用户口径：尺寸表在模型配置里，不该在定价页再录一遍）。
 * - 非 `derived`（读不到能力行）：退回原来的自由键值编辑，并在上方说明原因 ——
 *   锁住页面比让人填错更坏，但**不替它猜**一份档位清单。
 */
function SpecRowEditor<T extends KeyValueRow>({
  plan,
  derived,
  ariaPrefix,
  keyPlaceholder,
  valuePlaceholder,
  capability,
  makeRow,
  onRows,
}: {
  plan: RowPlan<T>;
  derived: boolean;
  ariaPrefix: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  capability: ModelCapabilityView | null;
  /** 自由编辑时「添加一行」要造的行（价格表得多带 `originalMc`，见 `MoneyField`） */
  makeRow: () => T;
  onRows: (rows: T[]) => void;
}) {
  if (!derived) {
    return (
      <>
        <Alert tone="warning">
          读不到这个模型的**能力行**，档位候选集派生不出来 —— 暂时按手工填键的方式编辑。
          档位以模型配置为准，配好后回到这里会显示成只读候选。
        </Alert>
        <KeyValueEditor
          rows={plan.rows}
          ariaPrefix={ariaPrefix}
          keyPlaceholder={keyPlaceholder}
          valuePlaceholder={valuePlaceholder}
          makeRow={makeRow}
          onChange={onRows}
        />
      </>
    );
  }

  const all = [...plan.rows, ...plan.orphans];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {all.map((row, index) => {
        const orphan = index >= plan.rows.length;
        const hint = capability === null ? '' : specKeyHint(capability, row);
        return (
          <div key={`${row.key}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <code style={{ fontSize: 12 }}>{row.key}</code>
              {orphan && (
                <span style={{ marginLeft: 8 }}>
                  {/* ⚠️ 不静默丢掉：静默删掉等于在一次「只改单价」的保存里顺手改了别的档位 */}
                  <Badge tone="warning">模型配置里没有这一档</Badge>
                </span>
              )}
              {hint && <div style={{ fontSize: 11, opacity: 0.7 }}>{hint}</div>}
            </div>
            <Input
              aria-label={`${ariaPrefix}值`}
              placeholder={valuePlaceholder}
              value={row.value}
              onChange={(e) =>
                onRows(all.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
              }
              style={{ width: 120 }}
            />
            {orphan ? (
              <Button
                size="sm"
                variant="ghost"
                title="删掉这一行"
                aria-label={`删掉${ariaPrefix}第 ${index + 1} 行`}
                icon={<Trash2 size={15} strokeWidth={2} />}
                onClick={() => onRows(all.filter((_, i) => i !== index))}
              />
            ) : (
              // 占位，让候选行的输入框与孤儿行左对齐
              <span style={{ width: 30 }} />
            )}
          </div>
        );
      })}
      {plan.orphans.length > 0 && (
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          <AlertTriangle size={13} strokeWidth={2} /> 标黄的行在**模型配置**里没有对应档位
          —— 用户根本选不到它。要么在模型配置里补上，要么在这里删掉。
        </div>
      )}
      {all.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          这个模型的能力行里没有档位可派生（尺寸/比例都没配）—— 请先在模型配置里补。
        </div>
      )}
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        要增加档位请改**模型配置**（那里是尺寸表的唯一来源），这里不提供手工加行。
      </div>
    </div>
  );
}

/**
 * 候选行下面那行小字：这个档位在模型配置里是多少像素。
 *
 * 图片按像素分档定价时（如 5.0 Pro 的 261 万像素分界），运营得看得见 2K = 419 万
 * 这种数才判得对档 —— 而那个数就记在能力行的矩阵里，不该让人去别处找。
 *
 * 能力行里没有这一档（孤儿行）时不给小字：那种行已经戴了徽标，再写一句是同义重复。
 */
function specKeyHint(capability: ModelCapabilityView, row: KeyValueRow): string {
  const size = sizeOfSpecKey(capability, row.key);
  if (size === null) return '';
  const pixels = describePixels(configuredSizePixels(capability, size));
  return pixels ? `模型配置：${pixels}` : '';
}

/* ============ 自由键值对编辑器（dims / 倍率 / 最低 token 用量表，以及读不到能力行时的规格表） ============
 *
 * 泛型是为了价格表：它每行还要多带一个 `originalMc`（未改动时原值写回，见
 * `MoneyField`），而 dims / 倍率 / 尺寸表不需要。`makeRow` 让「添加一行」知道该造哪种行。
 */
/* ============ 自由键值对编辑器（dims / 倍率 / 最低 token 用量表，以及读不到能力行时的规格表） ============
 *
 * 泛型是为了价格表：它每行还要多带一个 `originalMc`（未改动时原值写回，见
 * `MoneyField`），而 dims / 倍率不需要。`makeRow` 让「添加一行」知道该造哪种行。
 */
function KeyValueEditor<T extends KeyValueRow>({
  rows,
  onChange,
  ariaPrefix,
  keyPlaceholder,
  valuePlaceholder,
  makeRow,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  ariaPrefix: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  /** 造一行空行 —— 必须由调用方给：价格表要多带 originalMc */
  makeRow: () => T;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row, index) => (
        // 行没有稳定 id（键就是内容本身，可以改），所以按序号做 key ——
        // 这不是可排序列表，序号在编辑过程中是稳定的
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input
            aria-label={`${ariaPrefix}键`}
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))
            }
            style={{ flex: 1 }}
          />
          <Input
            aria-label={`${ariaPrefix}值`}
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) =>
              onChange(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
            }
            style={{ width: 120 }}
          />
          <Button
            size="sm"
            variant="ghost"
            title="删掉这一行"
            aria-label={`删掉${ariaPrefix}第 ${index + 1} 行`}
            icon={<Trash2 size={15} strokeWidth={2} />}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          icon={<Plus size={15} strokeWidth={2} />}
          // ⚠️ 一页上有好几组键值表（价格表 / 尺寸表 / 附加维度 / 整单倍率），
          //    每组的「添加一行」长得一模一样 —— 不带 aria-label 时读屏与自动化都分不出点的是哪一组
          aria-label={`给${ariaPrefix}添加一行`}
          onClick={() => onChange([...rows, makeRow()])}
        >
          添加一行
        </Button>
      </div>
    </div>
  );
}
