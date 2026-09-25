/* ============================================
 * Promotions 限时活动：名称 / 折扣 / 时间窗 / 条件（billing_promotions）
 *
 * 数据源 GET/POST/PUT/DELETE /api/admin/billing-promotions（后端转发 billing 的管理端接口）。
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**。
 *
 * ── 三处「配错了在计价侧是静默的」坑，界面上都要拦住或说清 ──────────────────────
 *
 * 1. **模型范围不能留空**：计价侧对空集合返回「命中」（= 不限）。一个「限时活动」把全站
 *    模型都打折几乎不会是本意，所以至少给一个模式；要全站就打 `*`，让它是显式的。
 * 2. **每日时段要么都填、要么都留空**：只填一半在计价侧等于**全天** ——
 *    配置与意图不符，所以这里在提交前就拦住。
 * 3. **时区**（默认 `Asia/Shanghai`）：跨零点的「夜间 22:00–06:00」必须按活动自己的时区算；
 *    名字写错会让命中它的任务提交失败（预扣路径解析时区）。
 *
 * ── 客户端的校验边界 ────────────────────────────────────────────────────────
 *
 * 这里只拦「不填就没法发请求」的（必填、折数、时间先后），**其余一律交给 billing**：
 * 规则抄第二份就会出现「这里放行、那边拒绝」。billing 的报错指得出是哪一列不对，
 * 界面原样呈现它。
 * ============================================ */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  createPromotion,
  deletePromotion,
  promotionKeys,
  promotionsOptions,
  updatePromotion,
  type Promotion,
  type PromotionInput,
} from '@/api/adminBillingPromotions';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import DiscountPolicyNotice from '../../components/DiscountPolicyNotice';
import {
  PROMOTION_STATUS_OPTIONS,
  TIER_OPTIONS,
  WEEKDAY_OPTIONS,
  describePatterns,
  describeSchedule,
  describeTiers,
  formatDiscount,
  parseZheToBp,
  shortDateTime,
  shortTime,
  statusLabel,
  statusTone,
} from '../../discountRules';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Field,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Table,
  TagInput,
} from '../../ui';

/** 表单状态：数值与时间都是**文字**（`datetime-local` / `time` 的原生值形态）。 */
interface FormState {
  code: string;
  name: string;
  discountZhe: string;
  modelIds: string[];
  taskTypes: string[];
  /** 勾选的等级；空 = 不限等级 */
  tierScope: string[];
  /** `2026-10-01T00:00`（datetime-local 的形态） */
  startAt: string;
  endAt: string;
  /** `22:00`（time 的形态）；两个都空 = 全天 */
  dailyTimeStart: string;
  dailyTimeEnd: string;
  daysOfWeek: number[];
  tz: string;
  status: string;
  priority: string;
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  discountZhe: '7',
  // 默认给 `*`（全部模型）：它是**显式**的全站折扣，比留空安全 —— 留空在计价侧也是「不限」，
  // 但界面上看不出区别，而「活动只对某几个模型生效」才是常态
  modelIds: ['*'],
  taskTypes: [],
  tierScope: [],
  startAt: '',
  endAt: '',
  dailyTimeStart: '',
  dailyTimeEnd: '',
  daysOfWeek: [],
  tz: 'Asia/Shanghai',
  status: 'draft',
  priority: '0',
};

function formFrom(row: Promotion): FormState {
  return {
    code: row.code,
    name: row.name,
    discountZhe: String(Number((row.discountBp / 1000).toFixed(3))),
    modelIds: [...row.modelIds],
    taskTypes: [...(row.taskTypes ?? [])],
    tierScope: [...(row.tierScope ?? [])],
    startAt: row.startAt.slice(0, 16),
    endAt: row.endAt.slice(0, 16),
    dailyTimeStart: shortTime(row.dailyTimeStart) ?? '',
    dailyTimeEnd: shortTime(row.dailyTimeEnd) ?? '',
    daysOfWeek: [...(row.daysOfWeek ?? [])],
    tz: row.tz,
    status: row.status,
    priority: String(row.priority),
  };
}

/**
 * 已存在的行 → 接口入参（**不校验**：它本来就是从这个接口读回来的）。
 *
 * <p>用于「就地停用 / 启用」这类不改其它字段的操作 —— 走一遍表单校验在这里没有意义，
 * 而且库里可能有一条更早写进去的历史行（比如标识不合现在的规则），
 * 那不该妨碍运营把它停掉。
 */
function inputFrom(row: Promotion): PromotionInput {
  return {
    code: row.code,
    name: row.name,
    discountBp: row.discountBp,
    modelIds: [...row.modelIds],
    taskTypes: row.taskTypes,
    tierScope: row.tierScope,
    startAt: row.startAt.slice(0, 16),
    endAt: row.endAt.slice(0, 16),
    dailyTimeStart: shortTime(row.dailyTimeStart),
    dailyTimeEnd: shortTime(row.dailyTimeEnd),
    daysOfWeek: row.daysOfWeek,
    tz: row.tz,
    status: row.status,
    priority: row.priority,
  };
}

/** 表单 → 接口入参；返回错误文案（`error` 存在就是没通过）。 */
function toInput(form: FormState): { input: PromotionInput } | { error: string } {
  if (!form.code.trim()) return { error: '活动标识必填（审计用，如 night-70）' };
  if (!form.name.trim()) return { error: '活动名称必填' };
  const discountBp = parseZheToBp(form.discountZhe);
  if (discountBp === null) {
    return { error: '折扣要填 0~10 之间的折数（如 7、6.5；10 折 = 原价）' };
  }
  if (form.modelIds.length === 0) {
    return { error: '模型范围至少填一个 —— 留空在计价侧等于「全部模型都打折」' };
  }
  if (!form.startAt || !form.endAt) return { error: '起始时间与结束时间都必填' };
  if (!(form.endAt > form.startAt)) {
    return { error: '结束时间必须晚于起始时间（活动区间是 [起始, 结束)）' };
  }
  // 只填一半在计价侧等于全天（见文件头第 2 条）—— 配置与意图不符，这里就拦住
  if ((form.dailyTimeStart === '') !== (form.dailyTimeEnd === '')) {
    return { error: '每日时段要么都填、要么都留空（都留空 = 全天）' };
  }
  if (!form.tz.trim()) return { error: '时区必填（跨零点时段靠它算对）' };
  if (!/^\d+$/.test(form.priority.trim())) return { error: '优先级要是非负整数' };

  return {
    input: {
      code: form.code.trim(),
      name: form.name.trim(),
      discountBp,
      modelIds: form.modelIds,
      // 空 → null：接口上「不限」只有一种表示
      taskTypes: form.taskTypes.length > 0 ? form.taskTypes : null,
      tierScope: form.tierScope.length > 0 ? form.tierScope : null,
      startAt: form.startAt,
      endAt: form.endAt,
      dailyTimeStart: form.dailyTimeStart === '' ? null : form.dailyTimeStart,
      dailyTimeEnd: form.dailyTimeEnd === '' ? null : form.dailyTimeEnd,
      daysOfWeek: form.daysOfWeek.length > 0 ? [...form.daysOfWeek].sort((a, b) => a - b) : null,
      tz: form.tz.trim(),
      status: form.status,
      priority: Number(form.priority.trim()),
    },
  };
}

export default function Promotions() {
  const queryClient = useQueryClient();
  const list = useQuery(promotionsOptions());

  const [editor, setEditor] = useState<{ id: number | null; form: FormState } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  const [actionError, setActionError] = useState('');
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: promotionKeys.all });

  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: PromotionInput }) =>
      id === null ? createPromotion(input) : updatePromotion(id, input),
    onSuccess: (row, variables) => {
      setEditor(null);
      setFormError('');
      setSaved(
        `${variables.id === null ? '已新建' : '已保存'}：${row.name} ${formatDiscount(row.discountBp)}` +
          `（状态 ${statusLabel(row.status)}）`,
      );
      void invalidate();
    },
    onError: (error) => {
      setFormError(isApiError(error) ? error.message : '保存失败，请稍后重试');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePromotion(id),
    onSuccess: () => {
      setDeleteTarget(null);
      setActionError('');
      setSaved('已删除。已提交的任务不受影响 —— 它们冻结了自己当时的折扣。');
      void invalidate();
    },
    onError: (error) => {
      setDeleteTarget(null);
      setActionError(isApiError(error) ? error.message : '删除失败，请稍后重试');
    },
  });

  /** 立刻切换启用 / 停用：运营最常用的动作，不该逼他打开弹窗改一个下拉再保存。 */
  const toggleStatus = useMutation({
    mutationFn: (row: Promotion) =>
      updatePromotion(row.id, {
        ...inputFrom(row),
        status: row.status === 'enabled' ? 'disabled' : 'enabled',
      }),
    onSuccess: (row) => {
      setActionError('');
      setSaved(`已${row.status === 'enabled' ? '启用' : '停用'}：${row.name}`);
      void invalidate();
    },
    onError: (error) => {
      setActionError(isApiError(error) ? error.message : '切换状态失败，请稍后重试');
    },
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);

  const openNew = () => {
    setFormError('');
    setSaved('');
    setEditor({ id: null, form: EMPTY_FORM });
  };

  return (
    <Page>
      <PageHeader
        title="限时活动"
        subtitle="按时间窗 / 时段 / 模型 / 等级配折扣；保存即生效（下次预扣就命中）"
        extra={
          <>
            <Button
              icon={<RefreshCw size={16} strokeWidth={2} />}
              disabled={list.isFetching}
              onClick={() => {
                setSaved('');
                setActionError('');
                void list.refetch();
              }}
            >
              重新加载
            </Button>
            <Button variant="primary" icon={<Plus size={16} strokeWidth={2} />} onClick={openNew}>
              新建活动
            </Button>
          </>
        }
      />

      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}

      {/* ⚠️ 这一页最容易被误解的地方，放在最上面 */}
      <Alert tone="info" title="改活动不影响已提交未结算的任务">
        任务提交时会把<b>当时命中的折扣</b>冻结进预留行，结算按冻结的那个系数复现，不会重新读这张表。
        所以「把活动停了 / 改成 5 折，怎么那笔还按老的算」的答案是：那笔在改动之前就提交了。
        改活动、提前结束、停用、删除，都只对<b>之后</b>提交的任务生效。
      </Alert>

      <DiscountPolicyNotice />

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <th>活动</th>
              <th>折扣</th>
              <th>模型 / 任务范围</th>
              <th>适用等级</th>
              <th>生效时间</th>
              <th>时段</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.isPending && (
              <tr>
                <td colSpan={8}>
                  <Empty message="加载中…" />
                </td>
              </tr>
            )}
            {list.isError && (
              <tr>
                <td colSpan={8}>
                  <Empty
                    message={isApiError(list.error) ? list.error.message : '获取活动失败'}
                    extra={<Button onClick={() => void list.refetch()}>重试</Button>}
                  />
                </td>
              </tr>
            )}
            {!list.isPending && !list.isError && rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <Empty
                    message="还没有任何限时活动 —— 所有任务都按原价计费"
                    extra={
                      <Button variant="primary" onClick={openNew}>
                        新建活动
                      </Button>
                    }
                  />
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <div>{row.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{row.code}</div>
                </td>
                <td>
                  <b>{formatDiscount(row.discountBp)}</b>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>万分比 {row.discountBp}</div>
                </td>
                <td>
                  <div>{describePatterns(row.modelIds, '（空 = 全部模型）')}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    任务：{describePatterns(row.taskTypes, '不限')}
                  </div>
                </td>
                <td>{describeTiers(row.tierScope)}</td>
                <td>
                  <div>{shortDateTime(row.startAt)}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    至 {shortDateTime(row.endAt)}（不含）
                  </div>
                </td>
                <td>{describeSchedule(row)}</td>
                <td>
                  <Badge tone={statusTone(row.status)} dot>
                    {statusLabel(row.status)}
                  </Badge>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={row.status === 'enabled' ? '停用' : '启用'}
                      aria-label={`${row.status === 'enabled' ? '停用' : '启用'} ${row.code}`}
                      onClick={() => toggleStatus.mutate(row)}
                    >
                      {row.status === 'enabled' ? '停用' : '启用'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="编辑"
                      aria-label={`编辑 ${row.code}`}
                      icon={<Pencil size={15} strokeWidth={2} />}
                      onClick={() => {
                        setFormError('');
                        setSaved('');
                        setEditor({ id: row.id, form: formFrom(row) });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="删除"
                      aria-label={`删除 ${row.code}`}
                      icon={<Trash2 size={15} strokeWidth={2} />}
                      onClick={() => setDeleteTarget(row)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {editor !== null && (
        <PromotionEditorModal
          key={editor.id ?? 'new'}
          form={editor.form}
          isNew={editor.id === null}
          saving={save.isPending}
          error={formError}
          onClose={() => setEditor(null)}
          onSave={(form) => {
            const parsed = toInput(form);
            if ('error' in parsed) {
              setFormError(parsed.error);
              return;
            }
            setFormError('');
            save.mutate({ id: editor.id, input: parsed.input });
          }}
        />
      )}

      {deleteTarget !== null && (
        <ConfirmModal
          title="删除活动"
          content={
            `删除「${deleteTarget.name}（${deleteTarget.code}）」？` +
            '已提交的任务不受影响（它们冻结了自己当时的折扣与活动码），' +
            '但之后提交的任务不再命中它。想留一手的话，用「停用」更稳妥。'
          }
          confirmText={remove.isPending ? '删除中…' : '确认删除'}
          onConfirm={() => remove.mutate(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </Page>
  );
}

/* ============ 新建 / 编辑弹窗 ============ */

const TZ_HINT = '活动自己的时区（默认 Asia/Shanghai）。下面的时间都按它理解，跨零点时段尤其依赖它';

function PromotionEditorModal({
  form,
  isNew,
  saving,
  error,
  onClose,
  onSave,
}: {
  form: FormState;
  isNew: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (form: FormState) => void;
}) {
  const [draft, setDraft] = useState<FormState>(form);
  const patch = (next: Partial<FormState>) => setDraft((d) => ({ ...d, ...next }));
  const bp = parseZheToBp(draft.discountZhe);

  /** 勾选式多选：等级与星期都是**封闭取值**，勾选比手打靠谱。 */
  const toggleIn = <T,>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

  return (
    <Modal
      open
      title={isNew ? '新建活动' : `编辑活动（${form.code}）`}
      width={860}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={saving} onClick={() => onSave(draft)}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px 24px' }}>
        <Field
          label="活动标识"
          hint="小写字母/数字/下划线/连字符，唯一。审计与排查靠它定位；改它不会改历史任务快照里记下的那个码"
        >
          <Input
            aria-label="活动标识"
            value={draft.code}
            placeholder="night-70"
            onChange={(e) => patch({ code: e.target.value })}
          />
        </Field>
        <Field label="活动名称" hint="前端展示用（如「夜间 7 折」）">
          <Input
            aria-label="活动名称"
            value={draft.name}
            placeholder="夜间 7 折"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field
          label="折扣（折）"
          hint={
            bp === null
              ? '填 0~10 之间的小数，最多两位（如 7、6.5）'
              : `写回接口的万分比 = ${bp}（10000 = 原价）`
          }
        >
          <Input
            aria-label="折扣"
            value={draft.discountZhe}
            placeholder="7"
            onChange={(e) => patch({ discountZhe: e.target.value })}
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', marginTop: 16 }}>
        <Field
          label="模型范围（至少一个）"
          hint="* = 全部；seedance-* = 前缀通配；或精确 model_id。⚠️ 中间带 * 匹配不到任何东西"
        >
          <TagInput
            ariaLabel="模型范围"
            values={draft.modelIds}
            placeholder="* 或 seedance-*"
            maxLength={128}
            onChange={(modelIds) => patch({ modelIds })}
          />
        </Field>
        <Field label="任务范围" hint="留空 = 不限任务类型（如 text2video）">
          <TagInput
            ariaLabel="任务范围"
            values={draft.taskTypes}
            placeholder="text2video"
            maxLength={64}
            onChange={(taskTypes) => patch({ taskTypes })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Field label="适用等级" hint="一个都不勾 = 不限等级">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {TIER_OPTIONS.map((option) => (
              <Checkbox
                key={option.value}
                checked={draft.tierScope.includes(option.value)}
                label={option.label}
                onChange={() => patch({ tierScope: toggleIn(draft.tierScope, option.value) })}
              />
            ))}
          </div>
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px 24px', marginTop: 16 }}>
        <Field label="起始时间（含）" hint="按活动时区的墙钟填写，不是浏览器时区">
          <Input
            type="datetime-local"
            aria-label="起始时间"
            value={draft.startAt}
            onChange={(e) => patch({ startAt: e.target.value })}
          />
        </Field>
        <Field label="结束时间（不含）" hint="必须晚于起始时间；区间是左闭右开">
          <Input
            type="datetime-local"
            aria-label="结束时间"
            value={draft.endAt}
            onChange={(e) => patch({ endAt: e.target.value })}
          />
        </Field>
        <Field label="时区" hint={TZ_HINT}>
          <Input
            aria-label="时区"
            value={draft.tz}
            placeholder="Asia/Shanghai"
            onChange={(e) => patch({ tz: e.target.value })}
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px 24px', marginTop: 16 }}>
        <Field label="每日时段起" hint="留空 = 全天。可跨天：22:00 → 06:00">
          <Input
            type="time"
            aria-label="每日时段起"
            value={draft.dailyTimeStart}
            onChange={(e) => patch({ dailyTimeStart: e.target.value })}
          />
        </Field>
        <Field label="每日时段止" hint="⚠️ 与开始要么都填、要么都留空（只填一个在计价侧等于全天）">
          <Input
            type="time"
            aria-label="每日时段止"
            value={draft.dailyTimeEnd}
            onChange={(e) => patch({ dailyTimeEnd: e.target.value })}
          />
        </Field>
        <Field label="优先级" hint="只影响这一页的排序，不参与优惠比较">
          <Input
            aria-label="优先级"
            value={draft.priority}
            onChange={(e) => patch({ priority: e.target.value })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Field label="生效星期" hint="一个都不勾 = 每天">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {WEEKDAY_OPTIONS.map((option) => (
              <Checkbox
                key={option.value}
                checked={draft.daysOfWeek.includes(option.value)}
                label={option.label}
                onChange={() => patch({ daysOfWeek: toggleIn(draft.daysOfWeek, option.value) })}
              />
            ))}
          </div>
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Field label="状态" hint="草稿不生效；启用后到时间窗内才命中；停用 = 立即不命中">
          <Select
            aria-label="状态"
            options={PROMOTION_STATUS_OPTIONS}
            value={draft.status}
            onChange={(status) => patch({ status })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Alert tone="warning">
          保存即生效（时间窗内下一次预扣就命中），但<b>不影响已提交未结算的任务</b> ——
          那些任务冻结了自己提交时的折扣。
        </Alert>
      </div>
    </Modal>
  );
}
