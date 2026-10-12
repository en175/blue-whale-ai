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
  rule: CatalogRuleView | null;
  creditsPerYuan: number | null;
  rateNotice: string;
  modelId: string;
  taskType: string;
  channel: ChannelId;
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

  const baseUnitOptions = BASE_UNIT_OPTIONS.some((o) => o.value === form.baseUnit)
    ? BASE_UNIT_OPTIONS
    : [...BASE_UNIT_OPTIONS, { value: form.baseUnit, label: `${form.baseUnit}（库里的现值）` }];

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

  const unitLabel = priceUnitLabel({
    baseUnit: form.baseUnit,
    unitDenominator: Number(form.unitDenominator.trim() || '1'),
  });


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
      {}
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
            这条规则只留了个空位：基准维度、单位分母都配好了，差的就是单价。
            在「单价待配」下提交任务是<b>直接失败</b>，不会按 0 免费生成（按 0 等于白送，
            而且账面上看不出来）。填好单价后把计价方式改成「按规格查表」或「常数单价」。
          </Alert>
        )}
      </div>

      <div style={{ ...GRID3, marginTop: 'var(--admin-space-4)' }}>
        {}
        {channelOf(channel).media === 'video' && (
          <Field label="单位分母" hint="每多少个单位收这份单价：1 = 每秒/每张">
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

      {}
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

      {}
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

function specKeyHint(capability: ModelCapabilityView, row: KeyValueRow): string {
  const size = sizeOfSpecKey(capability, row.key);
  if (size === null) return '';
  const pixels = describePixels(configuredSizePixels(capability, size));
  return pixels ? `本行尺寸：${pixels}` : '';
}

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
          {}
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
          aria-label="给维度绝对加价添加一行"
          onClick={() =>
            onChange([
              ...rows,
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
