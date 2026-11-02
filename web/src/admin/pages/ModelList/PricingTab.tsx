import { useEffect, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import {
  BASE_UNIT_OPTIONS,
  creditsToMc,
  describePriceInHuman,
  mcToCredits,
  priceUnitLabel,
  type CatalogRuleView,
  type PriceRow,
  type RuleForm,
} from '../../utils/billing-catalog/catalogDraft';
import {
  axisValueInKey,
  axisValueLabel,
  configuredSizePixels,
  defaultAxesForBaseUnit,
  describePixels,
  priceTableAxes,
  sizeOfSpecKey,
  type ModelCapabilityView,
  type SpecAxis,
} from '../../utils/billing-catalog/sizeCandidates';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  MetaRow,
  Select,
  Table,
  formGrid,
} from '../../ui';
import { GRID3 } from './formLayout';
import { KeyValueEditor } from './SpecRows';
import { channelOf, type ChannelId } from './model-form';

const ROUNDING_OPTIONS = [
  { value: 'halfUp', label: 'halfUp（四舍五入，默认）' },
  { value: 'ceil', label: 'ceil（向上取整，偏向平台）' },
  { value: 'floor', label: 'floor（向下取整，偏向用户）' },
];

interface PricingTabProps {
  rule: CatalogRuleView | null;
  modelId: string;
  taskType: string;
  channel: ChannelId;
  capability: ModelCapabilityView | null;
  form: RuleForm;
  onChange: (next: RuleForm) => void;
}

export default function PricingTab({
  rule,
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

  const axes = useMemo(
    () => (capability === null ? null : priceTableAxes(capability, priceAxes, originalPriceKeys)),
    [capability, priceAxes, originalPriceKeys],
  );

  const usableAxes = axes !== null && axes.every((axis) => axis.values.length > 0);

  useEffect(() => {
    if (form.priceKind !== 'table' || axes === null || !usableAxes) return;
    const combos = combinations(axes).map((picked) => priceKey(axes, picked));
    const kept = form.priceTable.filter((row) => row.key.trim() !== '');
    const known = new Set(kept.map((row) => normalizeKey(row.key)));
    const missing = combos.filter((key) => !known.has(normalizeKey(key)));
    if (kept.length === form.priceTable.length && missing.length === 0) return;
    onChange({
      ...form,
      priceTable: [...kept, ...missing.map((key) => ({ key, value: '', originalMc: null }))],
    });
  }, [form, axes, usableAxes, onChange]);

  const priceCredits = form.priceValue.value.trim();
  const parsedCredits = Number(priceCredits);
  const priceMc =
    priceCredits === '' || !Number.isFinite(parsedCredits) ? null : creditsToMc(parsedCredits);
  const humanPrice = priceMc === null ? '' : describePriceInHuman(priceMc, unitLabel);

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
              单价按<b>积分</b>填（可填小数），保存时换算成 mc 写回 —— 引擎与账本用的始终是 mc。
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
                ...(kind === 'table' && !form.priceTable.some((row) => row.key.trim() !== '')
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
            label={`基准单价（积分 / ${unitLabel}）`}
            hint={humanPrice ? `保存后写回库里的是：${humanPrice}` : '填积分即可，保存时换算成 mc 写回'}
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
            label={`价格表（规格键 → 单价，积分 / ${unitLabel}）`}
            hint="维度取值铺成矩阵；这里只填价"
            info={
              <>
                每行由一个维度的取值组合而成，规格键由系统生成、不需要手写。
                <div style={{ marginTop: 'var(--admin-space-2)' }}>
                  没配到的档位组合提交会被<b>拒绝</b>——不会按 0 免费生成。
                </div>
              </>
            }
          >
            {capability === null || axes === null || !usableAxes ? (
              <PriceTableReadOnly axes={capability === null ? null : axes} rows={form.priceTable} />
            ) : (
              <PriceTableEditor
                axes={axes}
                rows={form.priceTable}
                capability={capability}
                onChange={(priceTable) => patch({ priceTable })}
              />
            )}
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
      <div style={{ marginTop: 'var(--admin-space-4)' }}>
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
      </div>
    </>
  );
}

const AXIS_LABELS: Record<string, string> = {
  size: '尺寸档',
  resolution: '分辨率档',
  aspect_ratio: '比例',
  video: '视频输入',
  image_reference: '参考图',
  duration: '时长',
};

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function combinations(axes: SpecAxis[]): Array<Record<string, string>> {
  let picked: Array<Record<string, string>> = [{}];
  for (const axis of axes) {
    picked = picked.flatMap((prefix) =>
      axis.values.map((value) => ({ ...prefix, [axis.name]: value })),
    );
  }
  return picked;
}

function priceKey(axes: SpecAxis[], picked: Record<string, string>): string {
  return axes.map((axis) => `${axis.name}=${picked[axis.name]}`).join('|');
}

function describeKey(capability: ModelCapabilityView, axes: SpecAxis[], key: string): string {
  return axes
    .map((axis) => axisValueLabel(capability, axis.name, axisValueInKey(key, axis.name)))
    .join(' · ');
}

function specKeyHint(capability: ModelCapabilityView, key: string): string {
  const size = sizeOfSpecKey(capability, key);
  if (size === null) return '';
  const pixels = describePixels(configuredSizePixels(capability, size));
  return pixels ? `尺寸：${pixels}` : '';
}

function PriceTableEditor({
  axes,
  rows,
  capability,
  onChange,
}: {
  axes: SpecAxis[];
  rows: PriceRow[];
  capability: ModelCapabilityView;
  onChange: (rows: PriceRow[]) => void;
}) {
  const byKey = new Map(
    rows.filter((row) => row.key.trim() !== '').map((row) => [normalizeKey(row.key), row]),
  );
  const known = new Set(combinations(axes).map((picked) => normalizeKey(priceKey(axes, picked))));
  const orphans = rows.filter(
    (row) => row.key.trim() !== '' && !known.has(normalizeKey(row.key)),
  );

  const priceOf = (picked: Record<string, string>): string =>
    byKey.get(normalizeKey(priceKey(axes, picked)))?.value ?? '';

  const setCell = (picked: Record<string, string>, value: string) => {
    const key = priceKey(axes, picked);
    const target = normalizeKey(key);
    const found = rows.find((row) => normalizeKey(row.key) === target);
    if (found === undefined) {
      onChange([...rows, { key, value, originalMc: null }]);
      return;
    }
    onChange(rows.map((row) => (row === found ? { ...row, value } : row)));
  };

  const setRowValue = (key: string, value: string) => {
    const target = normalizeKey(key);
    onChange(rows.map((row) => (normalizeKey(row.key) === target ? { ...row, value } : row)));
  };

  const removeRow = (key: string) => {
    const target = normalizeKey(key);
    onChange(rows.filter((row) => normalizeKey(row.key) !== target));
  };

  const rowAxis = axes.length > 1 ? axes[axes.length - 2]! : axes[0]!;
  const colAxis = axes.length > 1 ? axes[axes.length - 1]! : null;
  const prefixAxes = axes.slice(0, Math.max(0, axes.length - 2));
  const sections = prefixAxes.length > 0 ? combinations(prefixAxes) : [{}];

  const cell = (picked: Record<string, string>) => {
    const key = priceKey(axes, picked);
    return (
      <Input
        size="sm"
        aria-label={`价格表 ${key} 单价`}
        placeholder="70"
        value={priceOf(picked)}
        onChange={(event) => setCell(picked, event.target.value)}
        style={{ width: 100 }}
      />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map((section) => {
        const sectionLabel = prefixAxes
          .map((axis) => axisValueLabel(capability, axis.name, section[axis.name] ?? ''))
          .join(' · ');
        return (
          <div key={sectionLabel === '' ? '全部' : sectionLabel}>
            {sectionLabel !== '' && (
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{sectionLabel}</div>
            )}
            <div
              style={{
                fontSize: 'var(--admin-font-xs)',
                color: 'var(--admin-text-muted)',
                marginBottom: 4,
              }}
            >
              {AXIS_LABELS[rowAxis.name] ?? rowAxis.name}
              {colAxis === null ? '' : ` × ${AXIS_LABELS[colAxis.name] ?? colAxis.name}`}
            </div>
            <Table>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>{colAxis === null ? '档位' : ''}</th>
                  {colAxis === null ? (
                    <th>单价（积分）</th>
                  ) : (
                    colAxis.values.map((value) => (
                      <th key={value}>{axisValueLabel(capability, colAxis.name, value)}</th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {rowAxis.values.map((rowValue) => (
                  <tr key={rowValue}>
                    <td>{axisValueLabel(capability, rowAxis.name, rowValue)}</td>
                    {colAxis === null ? (
                      <td>{cell({ ...section, [rowAxis.name]: rowValue })}</td>
                    ) : (
                      colAxis.values.map((colValue) => (
                        <td key={colValue}>
                          {cell({
                            ...section,
                            [rowAxis.name]: rowValue,
                            [colAxis.name]: colValue,
                          })}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        );
      })}
      {orphans.map((row) => (
        <PriceRowLine
          key={row.key}
          row={row}
          capability={capability}
          axes={axes}
          orphan
          onPrice={(value) => setRowValue(row.key, value)}
          onRemove={() => removeRow(row.key)}
        />
      ))}
      {orphans.length > 0 && (
        <div style={{ fontSize: 'var(--admin-font-xs)', color: 'var(--admin-text-muted)' }}>
          标黄的行在模型配置里没有对应档位，用户选不到它 —— 要么在模型配置里补上，要么删掉。
        </div>
      )}
    </div>
  );
}

function PriceRowLine({
  row,
  capability,
  axes,
  orphan,
  onPrice,
  onRemove,
}: {
  row: PriceRow;
  capability: ModelCapabilityView;
  axes: SpecAxis[];
  orphan?: boolean;
  onPrice: (value: string) => void;
  onRemove?: () => void;
}) {
  const hint = specKeyHint(capability, row.key);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13 }}>{describeKey(capability, axes, row.key)}</span>
        {orphan && (
          <span style={{ marginLeft: 8 }}>
            <Badge tone="warning">模型配置里没有这一档</Badge>
          </span>
        )}
        <div style={{ fontSize: 'var(--admin-font-xs)' }}>
          <code>{row.key}</code>
          {hint && <span style={{ marginLeft: 8 }}>{hint}</span>}
        </div>
      </div>
      <Input
        size="sm"
        aria-label={`价格表 ${row.key} 单价`}
        placeholder="70"
        value={row.value}
        onChange={(event) => onPrice(event.target.value)}
        style={{ width: 120 }}
      />
      {orphan ? (
        <Button
          size="sm"
          variant="ghost"
          title="删掉这一行"
          aria-label={`删掉价格表 ${row.key}`}
          icon={<Trash2 size={15} strokeWidth={2} />}
          onClick={onRemove}
        />
      ) : (
        <span style={{ width: 30 }} />
      )}
    </div>
  );
}

function PriceTableReadOnly({ axes, rows }: { axes: SpecAxis[] | null; rows: PriceRow[] }) {
  const missing = (axes ?? [])
    .filter((axis) => axis.values.length === 0)
    .map((axis) => AXIS_LABELS[axis.name] ?? axis.name);
  return (
    <>
      <Alert tone="warning">
        {axes === null
          ? '这个模型的定价维度还没适配，价格表只读展示。'
          : `${missing.join('、')}还没配置，价格表暂时只读。先到「尺寸与素材」配好，这里会自动铺开成可填价的行。`}
      </Alert>
      {rows.filter((row) => row.key.trim() !== '').length === 0 ? (
        <div style={{ fontSize: 'var(--admin-font-xs)', color: 'var(--admin-text-muted)' }}>
          库里还没有价格。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows
            .filter((row) => row.key.trim() !== '')
            .map((row) => (
              <div key={row.key} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                <code style={{ flex: 1, minWidth: 0, fontSize: 'var(--admin-font-xs)' }}>{row.key}</code>
                <span>{row.originalMc === null ? row.value : `${mcToCredits(row.originalMc)} 积分`}</span>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
