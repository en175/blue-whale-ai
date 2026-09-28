/* ============================================
 * 「定价」tab —— 一条能力行的计价规则（`generation_model_capability.pricing`）
 *
 * 从 `ModelBilling/RuleEditorModal.tsx` 搬过来（那一页已删除，定价编辑收进模型列表）。
 * 与旧版的两处结构性差别：
 *
 *   1. **不再是整份目录发布**：规则现在长在能力行上，保存就是一次 `PUT /api/admin/models/:id`
 *      ——没有「目录与能力行两个存储」的半失败问题；
 *   2. **模型 / 任务类型不再是可填的键**：`model_id` 与 `capability_type` 就是这一行的身份
 *      （一个能力行恰好对应一条规则），只读展示。
 *
 * ── 这一面要同时说清三件事 ────────────────────────────────────────────────────
 *
 * 1. **单价按「元」填**（官方价目表的单位：元 / 百万 token、元 / 张、元 / 次），
 *    写回库里的仍是 mc —— 换算在 `lib/billing-catalog/catalogDraft.ts` 里；
 * 2. **不编辑的字段原样带回去**（`usageSemantic` / `by` 等，见 `ruleFromForm` 的入参 `original`）；
 * 3. **「单价待配」（unset）是显式的空位**，不是「先不收费」——它是最容易误判的一处。
 *
 * ── 规格键不手敲：候选集派生自本行的尺寸 / 比例 ────────────────────────────────
 *
 * 价格表与尺寸表的**键**一律派生（`lib/billing-catalog/sizeCandidates.ts`），这里只填**数**
 * （宽高 / 单价）。库里有、本行档位里没有的键作为**孤儿**标出来——那是两份配置漂了的证据，
 * 不能静默丢掉。派生不出来时退回自由编辑并在界面上说明（**不猜**一份档位清单）。
 * ============================================ */
import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  BASE_UNIT_OPTIONS,
  describePriceInHuman,
  priceUnitLabel,
  yuanToMc,
  type CatalogRuleView,
  type DimPriceRow,
  type KeyValueRow,
  type RuleForm,
} from '../../lib/billing-catalog/catalogDraft';
import { filledPriceRows, planRows } from '../../lib/billing-catalog/rowPlan';
import {
  configuredSizePixels,
  defaultAxesForBaseUnit,
  describePixels,
  priceTableCandidates,
  sizeOfSpecKey,
  type ModelCapabilityView,
} from '../../lib/billing-catalog/sizeCandidates';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  MetaRow,
  Select,
  formGrid,
  type SelectOption,
} from '../../ui';
import { GRID3 } from './formLayout';
import SpecRows, { KeyValueEditor } from './SpecRows';
import { channelOf, type ChannelId } from './model-form';

const ROUNDING_OPTIONS = [
  { value: 'halfUp', label: 'halfUp（四舍五入，默认）' },
  { value: 'ceil', label: 'ceil（向上取整，偏向平台）' },
  { value: 'floor', label: 'floor（向下取整，偏向用户）' },
];

interface PricingTabProps {
  /** 该能力行的计价规则；`null` = 还没配 —— **提交会被拒**（billing 拿不到规则就算不出价）。 */
  rule: CatalogRuleView | null;
  /** 1 元 = 多少积分（换算率住定价目录里，这里只读它做换算） */
  creditsPerYuan: number | null;
  /** 换算率读不到时的原因；读得到时为空串 */
  rateNotice: string;
  /** 这一行的两个身份键（一个能力行恰好对应一条规则） */
  modelId: string;
  taskType: string;
  /** 渠道：**决定这条规则该有哪些字段**（只有视频渠道按 token 估算预扣）。
   *  后端 `pricingFieldErr` 按同一个判据收窄写闸门——这里少渲染一块，那里就会拒一次保存。 */
  channel: ChannelId;
  /** 本行的能力视图（档位 × 比例）—— 规格键候选集从这里派生 */
  capability: ModelCapabilityView | null;
  form: RuleForm;
  onChange: (next: RuleForm) => void;
}

export default function PricingTab({
  rule,
  creditsPerYuan,
  rateNotice,
  modelId,
  taskType,
  channel,
  capability,
  form,
  onChange,
}: PricingTabProps) {
  const patch = (next: Partial<RuleForm>) => onChange({ ...form, ...next });

  /** 按 token 估算预扣**只对视频媒介成立**（基准维度 usage.c、提交时刻没有真实 token）。
   *  与后端 `pricingFieldErr` 的渠道规则同一个判据：非视频渠道配了它，保存会被拒。 */
  const tokenEstimateApplies = channelOf(channel).media === 'video';

  /** 基准维度可能是库里的老值（新维度、文本类维度）：不在候选里就补一条，别显示成空白 */
  const baseUnitOptions = BASE_UNIT_OPTIONS.some((o) => o.value === form.baseUnit)
    ? BASE_UNIT_OPTIONS
    : [...BASE_UNIT_OPTIONS, { value: form.baseUnit, label: `${form.baseUnit}（库里的现值）` }];

  /** 维度绝对加价的维度候选：与基准维度**同一份白名单**（后端是同一个 `PRICING_BASE_UNITS`）。
   *  库里已有的、不在候选里的键同样补一条 —— 否则它会显示成空白，而一保存就没了。 */
  const dimPriceOptions = useMemo(() => {
    const extra = [
      ...new Set(
        form.dimPrices
          .map((row) => row.key.trim())
          .filter((key) => key !== '' && !BASE_UNIT_OPTIONS.some((o) => o.value === key)),
      ),
    ];
    return extra.length === 0
      ? BASE_UNIT_OPTIONS
      : [...BASE_UNIT_OPTIONS, ...extra.map((key) => ({ value: key, label: `${key}（库里的现值）` }))];
  }, [form.dimPrices]);

  /** 单价栏的量纲（「百万 token」/「次」/「张」）：表单还没保存，直接从当前编辑值推 */
  const unitLabel = priceUnitLabel({
    baseUnit: form.baseUnit,
    unitDenominator: Number(form.unitDenominator.trim() || '1'),
  });

  /* ── 规格键的候选集：来自本行的档位 × 比例（见 sizeCandidates.ts 的文件头） ───── */

  /** 价格表的定价轴：库里已有的规则以它自己声明的 `basePrice.by` 为准（那是事实），
   *  新规则（还没有 by）按基准维度给一个初值。 */
  const priceAxes = useMemo(() => {
    const declared = rule?.basePrice?.by;
    if (Array.isArray(declared)) {
      const names = declared
        .filter((axis): axis is string => typeof axis === 'string' && axis.trim().length > 0)
        .map((axis) => axis.trim());
      if (names.length) return names;
    }
    return defaultAxesForBaseUnit(form.baseUnit);
  }, [rule, form.baseUnit]);

  const originalPriceKeys = useMemo(() => Object.keys(rule?.basePrice?.table ?? {}), [rule]);

  /** `null` = 派生不出来（档位/比例没配）→ 退回自由编辑 */
  const priceCandidates = useMemo(
    () => (capability === null ? null : priceTableCandidates(capability, priceAxes, originalPriceKeys)),
    [capability, priceAxes, originalPriceKeys],
  );

  const pricePlan = useMemo(
    () => planRows(form.priceTable, priceCandidates, (key) => ({ key, value: '', originalMc: null })),
    [form.priceTable, priceCandidates],
  );

  const priceYuan = form.priceValue.value.trim();
  const priceMc = priceYuan === '' ? null : yuanToMc(Number(priceYuan), creditsPerYuan);
  const humanPrice = priceMc === null ? '' : describePriceInHuman(priceMc, creditsPerYuan, unitLabel);

  return (
    <>
      {/* 「现在是什么」保持可见：这一行的身份键，藏起来就得去别处找。
          用 MetaRow 而不是蓝色色块 —— 色块是装饰，这里要表达的是状态。 */}
      <MetaRow
        items={[
          { label: '模型', value: modelId || '（还没填 model_id）' },
          { label: '任务类型', value: taskType },
        ]}
      />


      {rule === null && (
        <Alert tone="warning" title="这条模型还没配价 —— 配好之前它的提交会被拒绝">
          下面是按默认值起的一张空表单。填好基准维度与单价后保存即可（保存就是一次普通的能力行更新，
          不需要再发布定价目录）。不配价不等于免费：提交时会因「算不出价」被直接拒绝。
        </Alert>
      )}

      {rateNotice && <Alert tone="warning" title="读不到换算率（1 元 = 多少积分）">{rateNotice}</Alert>}

      <div style={formGrid(2)}>
        <Field label="基准维度" hint="按哪个用量维度计费；constant:1 = 按次">
          <Select
            aria-label="基准维度"
            options={baseUnitOptions}
            value={form.baseUnit}
            onChange={(baseUnit) => patch({ baseUnit })}
          />
        </Field>
        <Field
          label="计价方式"
          hint="常数单价、按规格查表，或「单价待配」留空"
          info={
            <>
              单价按<b>元</b>填（官方价目表就是这个单位），保存时按定价目录里的换算率
              <b> 1 元 = {creditsPerYuan ?? '—'} 积分 </b>折成 mc 写回 —— 引擎与账本用的始终是 mc。
              <div style={{ marginTop: 'var(--admin-space-2)' }}>
                被改过的栏才重新换算：没动过的价<b>原值写回</b>，所以「打开看一眼、点保存」
                不会把价格挪动哪怕 1 mc。
              </div>
            </>
          }
        >
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

      <div style={{ marginTop: 'var(--admin-space-4)' }}>
        {form.priceKind === 'const' ? (
          <Field
            label={`基准单价（元 / ${unitLabel}）`}
            hint={humanPrice ? `保存后写回库里的是：${humanPrice}` : '按定价目录里的换算率折成 mc 写回'}
          >
            <Input
              aria-label="基准单价"
              value={form.priceValue.value}
              placeholder="例如 70"
              onChange={(e) => patch({ priceValue: { ...form.priceValue, value: e.target.value } })}
            />
          </Field>
        ) : form.priceKind === 'table' ? (
          <Field
            label={`价格表（规格键 → 单价，元 / ${unitLabel}）`}
            hint="行来自本行的尺寸与比例；这里只填价"
            info={
              <>
                档位候选派生自本行声明的<b>尺寸与比例</b>，你只需要填价。
                <div style={{ marginTop: 'var(--admin-space-2)' }}>
                  没配到的档位组合提交会被<b>拒绝</b>——不会按 0 免费生成。
                </div>
              </>
            }
          >
            <SpecRows
              plan={pricePlan}
              derived={priceCandidates !== null}
              ariaPrefix="价格表"
              keyPlaceholder="resolution=720p|video=1"
              valuePlaceholder="70"
              fallbackNotice="本行的尺寸档与比例还没配，档位候选集派生不出来 —— 暂时按手工填键的方式编辑。配好尺寸与比例后，这里会显示成只读候选。"
              hintOf={(row) => (capability === null ? '' : specKeyHint(capability, row))}
              makeRow={() => ({ key: '', value: '', originalMc: null })}
              onRows={(priceTable) =>
                patch({ priceTable: priceCandidates === null ? priceTable : filledPriceRows(priceTable) })
              }
            />
          </Field>
        ) : (
          <Alert tone="warning" title="单价还没填 —— 这个模型的提交会被拒绝">
            这条规则只留了个空位：基准维度、token 估算参数、单位分母都配好了，差的就是单价。
            在「单价待配」下提交任务是<b>直接失败</b>，不会按 0 免费生成（按 0 等于白送，
            而且账面上看不出来）。填好单价后把计价方式改成「按规格查表」或「常数单价」。
          </Alert>
        )}
      </div>

      <div style={{ ...GRID3, marginTop: 'var(--admin-space-4)' }}>
        {/* `unitDenominator ≠ 1` 只在「每百万 token」这个口径下有意义（分母就是为它存在的）。
            其余渠道的分母恒为 1，写成别的会把单价整体缩小若干倍——所以非 token 渠道直接不渲染，
            让这个字段只有一个合法值。后端同判据（`unitDenominator ≠ 1` 必须与 tokenEstimate 同时出现）。 */}
        {tokenEstimateApplies && (
          <Field label="单位分母" hint="每多少个单位收这份单价：1 = 每秒/每张，1000000 = 每百万 token">
            <Input
              aria-label="单位分母"
              value={form.unitDenominator}
              onChange={(e) => patch({ unitDenominator: e.target.value })}
            />
          </Field>
        )}
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

      <div style={{ marginTop: 'var(--admin-space-4)' }}>
        <Field label="舍入方式" hint="mc 换算成整数积分时怎么取整：ceil 时折扣要 ≥ 1 积分才看得出来">
          <Select
            aria-label="舍入方式"
            options={ROUNDING_OPTIONS}
            value={form.rounding}
            onChange={(rounding) => patch({ rounding })}
          />
        </Field>
      </div>

      {/* ── token 预扣估算参数 ──────────────────────────────────────────────
          为什么单独一块：视频按 token 计价的规则<b>没有它就算不出预扣</b>
          （基准维度是 usage.c，而提交时刻没有真实 token），提交会被拒绝。
          而它是「预扣用什么公式」的参数，不是结算口径 —— 结算永远按上游返回的真值。
          ⚠️ <b>只对视频渠道渲染</b>：别的渠道不按 token 估（后端同判据，配了会被拒），
          给他们看这块只会让人以为「勾上就能按 token 算」。 */}
      {tokenEstimateApplies && (
        <>
          <div style={{ marginTop: 'var(--admin-space-5)', borderTop: '1px solid var(--admin-border)', paddingTop: 'var(--admin-space-4)' }}>
            <Checkbox
              checked={form.tokenEstimateEnabled}
              onChange={(tokenEstimateEnabled) => patch({ tokenEstimateEnabled })}
              label="按 token 估算预扣（基准维度是 usage.c 的规则需要勾）"
            />
            <div style={{ fontSize: 'var(--admin-font-xs)', marginTop: 'var(--admin-space-2)', }}>
              服务端按火山的官方公式（宽 × 高 × 帧率 × 时长 ÷ 除数）估一个 token 上限来冻结；
              结算仍按上游返回的真实 token 计价。不勾 = 这条规则不做估算 ——
              基准维度是 usage.c 而不勾，提交时会因「算不出契约量」被拒绝。
            </div>
          </div>

          {form.tokenEstimateEnabled && (
            <>
              <div style={{ ...GRID3, marginTop: 'var(--admin-space-3)' }}>
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
              {/* ── 最低 token 用量（官方明文规则）────────────────────────────────
                  火山：「当输入包含视频时，如果估算 token 用量 ＜ 最低 token 用量，
                  则按最低 token 用量计算视频价格」。官方原页只给了两张表格的飞书链接，
                  没有公开可抄的形态 —— 所以这是一块<b>留空即不做下限</b>的配置位。
                  留空不是「还没配」，是一个明确的状态，界面上要说清楚。 */}
              <div style={{ marginTop: 'var(--admin-space-3)' }}>
                <Field
                  label="最低 token 用量表（规格键 → 最低 token 数，选填）"
                  hint="火山官方规则：<b>含视频输入时</b>，估算 token ＜ 这一格的下限 ⇒ 按下限计费。
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
        </>
      )}

      <div style={{ ...formGrid(2), marginTop: 'var(--admin-space-4)' }}>
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

      {/* ── 维度绝对加价（`dimPrices`）─────────────────────────────────────────────
          与上面两块「相对量」并列但不同性质：`dims` 是万分比 × 基准单价、`multipliers` 是整单连乘，
          而这里是**每个单位固定多少钱**，与基准单价无关 —— 单价分档的规则（输出图 0.3/0.6 两档）
          只有它能表达「参考图每张 0.02 元在两档下是同一个数」。 */}
      <div style={{ marginTop: 'var(--admin-space-4)' }}>
        <Field
          label="维度绝对加价（元 / 每个单位）"
          hint={<>按维度收固定单价，<b>不乘</b>基准单价 —— 与上面的「附加维度」那种相对加价不同</>}
          info={
            <>
              这里给的是<b>绝对值</b>：每个单位固定多少钱，与基准单价无关。所以它表达得了
              「输出图分 0.3 / 0.6 两档，但参考图每张都是 0.02 元」——上面的「附加维度」是万分比，
              同一个数在两档下会算出两个价。
              <div style={{ marginTop: 'var(--admin-space-2)' }}>
                每行一个维度（与基准维度同一份白名单）。单价按<b>元</b>填、写回是 mc，必须
                <b>大于 0</b>：要让某个维度免费就整行删掉，别写 0。勾上「首张免费」则第一个单位
                不计费（火山 Seedream 5.0 Pro 的「首张参考图免费」就是它）。
              </div>
              <div style={{ marginTop: 'var(--admin-space-2)' }}>
                ⚠️ 与「积分上限」<b>互斥</b>：上限计价跳过用量计算、算不到这份加价，预扣会冻少，
                结算超出后只记应收（少收且静默）。两者只能配一个。
              </div>
            </>
          }
        >
          <DimPriceEditor
            rows={form.dimPrices}
            options={dimPriceOptions}
            onChange={(dimPrices) => patch({ dimPrices })}
          />
        </Field>
      </div>
    </>
  );
}

/**
 * 候选行下面那行小字：这个档位在本行里是多少像素。
 *
 * 图片按像素分档定价时（如 5.0 Pro 的 261 万像素分界），运营得看得见 2K = 419 万
 * 这种数才判得对档 —— 而那个数就记在本行的尺寸矩阵里，不该让人去别处找。
 *
 * 本行里没有这一档（孤儿行）时不给小字：那种行已经戴了徽标，再写一句是同义重复。
 */
function specKeyHint(capability: ModelCapabilityView, row: KeyValueRow): string {
  const size = sizeOfSpecKey(capability, row.key);
  if (size === null) return '';
  const pixels = describePixels(configuredSizePixels(capability, size));
  return pixels ? `本行尺寸：${pixels}` : '';
}

/**
 * 维度绝对加价表（维度 + 单价(元) + 首张免费）的行编辑器。
 *
 * <p>为什么不复用 `KeyValueEditor`：它的一行只有「键 + 值」两个输入，而这里的维度必须落在
 * 白名单里（用下拉），并且每行还多一个「首张免费」。行的骨架（删除 / 添加一行）与它保持一致，
 * 免得同一页里出现两种表格。
 */
function DimPriceEditor({
  rows,
  options,
  onChange,
}: {
  rows: DimPriceRow[];
  options: readonly SelectOption[];
  onChange: (rows: DimPriceRow[]) => void;
}) {
  const patchRow = (index: number, next: Partial<DimPriceRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--admin-space-2)' }}>
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 'var(--admin-space-3)' }}>
          {/* 列方向的弹性容器：自绘 Select 的根是 inline-block，只有列方向拉伸能让它撑满这一格
              （`flex: 1` 的块级包裹在行方向上不会把 inline-block 的子元素拉宽） */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Select
              aria-label={`维度绝对加价第 ${index + 1} 行维度`}
              options={options}
              value={row.key.trim()}
              placeholder="选择维度…"
              onChange={(key) => patchRow(index, { key })}
            />
          </div>
          <Input
            aria-label={`维度绝对加价第 ${index + 1} 行单价`}
            placeholder="0.02"
            value={row.value}
            onChange={(e) => patchRow(index, { value: e.target.value })}
            style={{ width: 120 }}
          />
          <Checkbox
            aria-label={`维度绝对加价第 ${index + 1} 行首张免费`}
            checked={row.firstFree}
            onChange={(firstFree) => patchRow(index, { firstFree })}
            label="首张免费"
          />
          <Button
            size="sm"
            variant="ghost"
            title="删掉这一行"
            aria-label={`删掉维度绝对加价第 ${index + 1} 行`}
            icon={<Trash2 size={15} strokeWidth={2} />}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          icon={<Plus size={15} strokeWidth={2} />}
          // 一页上有好几组可增删的表，每组的「添加一行」长得一模一样 ——
          // 不带 aria-label 时读屏与自动化都分不出点的是哪一组（与 KeyValueEditor 同一条理由）
          aria-label="给维度绝对加价添加一行"
          onClick={() =>
            onChange([
              ...rows,
              // 新建的行没有任何原值可依（`originalMc` / `originalSpec` 都是空）
              { key: '', value: '', originalMc: null, firstFree: false, originalSpec: null },
            ])
          }
        >
          添加一行
        </Button>
      </div>
    </div>
  );
}
