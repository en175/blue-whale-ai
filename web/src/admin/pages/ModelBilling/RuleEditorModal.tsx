/* ============================================
 * 规则编辑弹窗 —— 定价目录里**一条规则**的编辑面
 *
 * 从 index.tsx 拆出来（那一页已经很长）：弹窗与页面之间只有一个 `onSave` 的接口，
 * 拆开之后「页面怎么展示目录」与「一条规则怎么编辑」各自独立。
 *
 * ── 这一面要同时说清三件事 ────────────────────────────────────────────────────
 *
 * 1. **单位是 mc**（1 积分 = 1000 mc），旁边实时给出「N 积分 ≈ ¥X.XX」——理由见 index.tsx
 *    文件头「单位：为什么界面上是 mc」；
 * 2. **不编辑的字段原样带回去**（`usageSemantic` / `by` 等，见 `ruleFromForm` 的入参 `original`）；
 * 3. **「单价待配」（unset）是显式的空位**，不是「先不收费」——弹窗要把它说清楚，
 *    因为它是运营最可能误判的一处（详见下面那段 Alert 的文案）。
 * ============================================ */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  BASE_UNIT_OPTIONS,
  describePriceInHuman,
  ruleFormError,
  ruleFromForm,
  type CatalogRuleView,
  type KeyValueRow,
  type RuleForm,
} from './catalogDraft';
import { Alert, Button, Checkbox, Field, Input, Modal, Select } from '../../ui';

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
  onClose,
  onSave,
}: {
  state: RuleEditorState;
  creditsPerYuan: number | null;
  onClose: () => void;
  /** 回传组装好的规则，以及它在目录里的两个键（模型 / 任务类型） */
  onSave: (rule: CatalogRuleView, modelId: string, taskType: string) => void;
}) {
  const [form, setForm] = useState<RuleForm>(state.initial);
  const [error, setError] = useState('');
  const patch = (next: Partial<RuleForm>) => setForm((f) => ({ ...f, ...next }));

  /** 基准维度可能是目录里的老值（新维度、文本类维度）：不在候选里就补一条，别显示成空白 */
  const baseUnitOptions = BASE_UNIT_OPTIONS.some((o) => o.value === form.baseUnit)
    ? BASE_UNIT_OPTIONS
    : [...BASE_UNIT_OPTIONS, { value: form.baseUnit, label: `${form.baseUnit}（目录里的现值）` }];

  const priceValue = Number(form.priceValue.trim());
  const humanPrice = Number.isFinite(priceValue)
    ? describePriceInHuman(priceValue, creditsPerYuan)
    : '';

  const submit = () => {
    const message = ruleFormError(form);
    if (message !== null) {
      setError(message);
      return;
    }
    try {
      onSave(ruleFromForm(form, state.original), form.modelId.trim(), form.taskType.trim());
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
                  ? { priceTable: [{ key: '', value: '' }] }
                  : {}),
              });
            }}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        {form.priceKind === 'const' ? (
          <Field
            label="基准单价（mc）"
            hint={humanPrice ? `当前 = ${humanPrice}` : '1 积分 = 1000 mc'}
          >
            <Input
              aria-label="基准单价"
              value={form.priceValue}
              placeholder="例如 100000（= 100 积分）"
              onChange={(e) => patch({ priceValue: e.target.value })}
            />
          </Field>
        ) : form.priceKind === 'table' ? (
          <Field
            label="价格表（规格键 → 单价 mc）"
            hint="规格键与提交时的规格一致（例如 video=0 / video=1 / size=2k）；键不区分大小写，等价键重复会被拒绝"
          >
            <KeyValueEditor
              rows={form.priceTable}
              ariaPrefix="价格表"
              keyPlaceholder="video=0"
              valuePlaceholder="100000"
              onChange={(priceTable) => patch({ priceTable })}
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
              hint="规格键与价格表同一套语法（resolution=720p|aspect_ratio=16:9）。
                    官方表里没有的档位+比例组合就是没配 —— 那时预扣推不出，提交会被拒绝"
            >
              <KeyValueEditor
                rows={form.tokenDimensions}
                ariaPrefix="token 尺寸表"
                keyPlaceholder="resolution=720p|aspect_ratio=16:9"
                valuePlaceholder="1248x704"
                onChange={(tokenDimensions) => patch({ tokenDimensions })}
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
            onChange={(dims) => patch({ dims })}
          />
        </Field>
        <Field label="整单倍率（万分比）" hint="整单连乘：12000 = 1.2 倍">
          <KeyValueEditor
            rows={form.multipliers}
            ariaPrefix="整单倍率"
            keyPlaceholder="usage.referenceCount"
            valuePlaceholder="12000"
            onChange={(multipliers) => patch({ multipliers })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Alert tone="info">
          单位是 mc（1 积分 = 1000 mc）。界面按 mc 编辑而不是按元：元 ↔ mc 几乎永远是长小数，
          而换算着编辑会让没被改动的字段在保存时被挪动几个 mc。
        </Alert>
      </div>
    </Modal>
  );
}

/* ============ 键值对编辑器（dims / multipliers / 价格表共用） ============ */

function KeyValueEditor({
  rows,
  onChange,
  ariaPrefix,
  keyPlaceholder,
  valuePlaceholder,
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  ariaPrefix: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
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
          onClick={() => onChange([...rows, { key: '', value: '' }])}
        >
          添加一行
        </Button>
      </div>
    </div>
  );
}
