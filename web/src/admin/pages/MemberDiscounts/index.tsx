/* ============================================
 * MemberDiscounts 会员折扣：按等级配折扣（billing_member_discounts）
 *
 * 数据源 GET/POST/PUT/DELETE /api/admin/billing-discounts（后端转发 billing 的管理端接口）。
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**。
 *
 * ── 这一页最要紧的一句话：改折扣不影响已提交未结算的任务 ──────────────────────────
 *
 * job 提交时把**命中的结果**（万分比系数）冻进 `billing_cost_reservations.discount_bp`，
 * 结算按冻结值复现、**不重新解析**这张表。所以运营改完折扣后发现某笔还按老的算时，
 * 答案不是「系统没生效」，而是「那笔在改之前就提交了」。
 * 这一条写在页面最上方那条提示里 —— 不说清，它会被反复当成 bug 报上来。
 *
 * ── 等级是下拉，不是输入框 ───────────────────────────────────────────────────
 *
 * 库里 `tier` 认不出时按 `free` 处理（`libs/core/identity/tier.ts` 的口径）——
 * 手打一个 `PRO` 会让这条折扣**静默不生效**：界面上看着配了，用户却享受不到。
 * 所以这里只能从下拉里选，且新建时**不预选**任何等级（预选哪个都是猜）。
 * ============================================ */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  createMemberDiscount,
  deleteMemberDiscount,
  memberDiscountKeys,
  memberDiscountsOptions,
  updateMemberDiscount,
  type MemberDiscount,
  type MemberDiscountInput,
} from '@/api/adminBillingDiscounts';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import DiscountPolicyNotice from '../../components/DiscountPolicyNotice';
import {
  MEMBER_STATUS_OPTIONS,
  TIER_OPTIONS,
  formatDiscount,
  parseZheToBp,
  statusLabel,
  statusTone,
  tierLabel,
} from '../../discountRules';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Hint,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Table,
  formGrid,
} from '../../ui';

/** 表单状态：数字与折都存**文字**，提交时才解析成整数。 */
interface FormState {
  /** 空串 = 还没选（新建时不预选等级） */
  tier: string;
  modelPattern: string;
  taskPattern: string;
  /** 折，例如 `9` / `8.5` */
  discountZhe: string;
  /** 展示优先级，整数 */
  priority: string;
  status: string;
}

const EMPTY_FORM: FormState = {
  tier: '',
  modelPattern: '*',
  taskPattern: '*',
  discountZhe: '9',
  priority: '0',
  status: 'enabled',
};

function formFrom(row: MemberDiscount): FormState {
  return {
    tier: row.tier,
    modelPattern: row.modelPattern,
    taskPattern: row.taskPattern,
    // 9000 → `9`，8500 → `8.5`（去掉多余的 0，人看着才是「9 折」）
    discountZhe: String(Number((row.discountBp / 1000).toFixed(3))),
    priority: String(row.priority),
    status: row.status,
  };
}

/** 表单 → 接口入参；返回错误文案（`error` 存在就是没通过）。 */
function toInput(form: FormState): { input: MemberDiscountInput } | { error: string } {
  if (!form.tier) return { error: '请选择会员等级' };
  const discountBp = parseZheToBp(form.discountZhe);
  if (discountBp === null) {
    return { error: '折扣要填 0~10 之间的折数（如 9、8.5；10 折 = 原价）' };
  }
  if (!form.modelPattern.trim()) return { error: '模型匹配必填（全匹配写 * ）' };
  if (!form.taskPattern.trim()) return { error: '任务匹配必填（全匹配写 * ）' };
  if (!/^\d+$/.test(form.priority.trim())) return { error: '优先级要是非负整数（只影响展示排序）' };
  return {
    input: {
      tier: form.tier,
      modelPattern: form.modelPattern.trim(),
      taskPattern: form.taskPattern.trim(),
      discountBp,
      priority: Number(form.priority.trim()),
      status: form.status,
    },
  };
}

export default function MemberDiscounts() {
  const queryClient = useQueryClient();
  const list = useQuery(memberDiscountsOptions());

  const [editor, setEditor] = useState<{ id: number | null; form: FormState } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemberDiscount | null>(null);
  /** 页面级错误（加载 / 删除） */
  const [actionError, setActionError] = useState('');
  /** 弹窗内的错误（校验 / 保存）：留在弹窗里，别关掉它让人把填的内容重来一遍 */
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: memberDiscountKeys.all });

  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: MemberDiscountInput }) =>
      id === null ? createMemberDiscount(input) : updateMemberDiscount(id, input),
    onSuccess: (row, variables) => {
      setEditor(null);
      setFormError('');
      setSaved(
        `${variables.id === null ? '已新建' : '已保存'}：${tierLabel(row.tier)} ${formatDiscount(row.discountBp)}` +
          '（对之后提交的任务生效）',
      );
      void invalidate();
    },
    onError: (error) => {
      // 「你配得不对」（400）与「billing 不可用」（503）的文案都由后端给出，原样呈现
      setFormError(isApiError(error) ? error.message : '保存失败，请稍后重试');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteMemberDiscount(id),
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

  const rows = useMemo(
    () => [...(list.data ?? [])].sort((a, b) => a.tier.localeCompare(b.tier) || b.priority - a.priority),
    [list.data],
  );

  const openNew = () => {
    setFormError('');
    setSaved('');
    setEditor({ id: null, form: EMPTY_FORM });
  };

  return (
    <Page>
      <PageHeader
        title={
          <>
            会员折扣{' '}
            <Hint title="这一页的两条规矩">
              <div>
                <b>改折扣不影响已提交未结算的任务。</b>
                任务提交时会把当时命中的折扣冻结进预留行，结算按冻结的那个系数复现，不会重新读这张表
                —— 所以「刚把 pro 改成 8 折，怎么那笔还按 9 折算」的答案，是那笔在改动之前就提交了。
              </div>
              <div>
                <b>同一等级命中多条时取最优惠，不叠加。</b>
                一个等级可以配多条（例如「所有模型 9 折」+「seedance 系 8 折」），
                命中多条时取折扣最大的那一条；「优先级」只影响这一页的显示顺序，不参与优惠比较。
              </div>
            </Hint>
          </>
        }
        subtitle="按会员等级配置长期折扣；保存即生效（下次预扣就命中）"
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
              新增折扣
            </Button>
          </>
        }
      />

      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}

      {/* 两条页面级规矩收在标题旁的一个 ? 里。
          ⚠️ 之前它们是两个**独立成行**的 ?，悬在标题下方各占一行 —— 图标没有锚点，
          读者根本不知道它在说哪一块。说明挂在它说明的东西旁边，不是排在页面里。 */}
      <DiscountPolicyNotice />

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <th>等级</th>
              <th>模型匹配</th>
              <th>任务匹配</th>
              <th>折扣</th>
              <th>优先级</th>
              <th>状态</th>
              <th>更新时间</th>
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
                    message={isApiError(list.error) ? list.error.message : '获取会员折扣失败'}
                    extra={<Button onClick={() => void list.refetch()}>重试</Button>}
                  />
                </td>
              </tr>
            )}
            {!list.isPending && !list.isError && rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <Empty
                    message="还没有任何会员折扣 —— 会员提交任务时按原价计费"
                    extra={
                      <Button variant="primary" onClick={openNew}>
                        新增折扣
                      </Button>
                    }
                  />
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Badge tone="accent">{tierLabel(row.tier)}</Badge>
                </td>
                <td>{row.modelPattern}</td>
                <td>{row.taskPattern}</td>
                <td>
                  <b>{formatDiscount(row.discountBp)}</b>
                  <div style={{ fontSize: 'var(--admin-font-xs)', }}>万分比 {row.discountBp}</div>
                </td>
                <td>{row.priority}</td>
                <td>
                  <Badge tone={statusTone(row.status)} dot>
                    {statusLabel(row.status)}
                  </Badge>
                </td>
                <td>{row.gmtModified.replace('T', ' ').slice(0, 16)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="编辑"
                      aria-label={`编辑 ${row.tier} 的折扣`}
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
                      aria-label={`删除 ${row.tier} 的折扣`}
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
        <DiscountEditorModal
          // 换一条编辑时重建弹窗：否则草稿会沿用上一条的内容
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
          title="删除会员折扣"
          content={
            `删除「${tierLabel(deleteTarget.tier)} ${formatDiscount(deleteTarget.discountBp)}` +
            `（${deleteTarget.modelPattern} / ${deleteTarget.taskPattern}）」？` +
            '已提交的任务不受影响（它们冻结了自己当时的折扣），但之后的提交会按剩余规则或原价计费。' +
            '只想暂时不生效的话，编辑它并改成「停用」更稳妥。'
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

function DiscountEditorModal({
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

  return (
    <Modal
      open
      title={isNew ? '新增会员折扣' : `编辑会员折扣（${tierLabel(form.tier)}）`}
      width={720}
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

      <div style={formGrid(2)}>
        <Field label="会员等级" hint="认不出的等级会被当成免费用户 —— 所以这里只能选，不能填">
          <Select
            aria-label="会员等级"
            placeholder="请选择等级"
            options={TIER_OPTIONS}
            value={draft.tier}
            onChange={(tier) => patch({ tier })}
          />
        </Field>
        <Field
          label="折扣（折）"
          hint={
            bp === null
              ? '填 0~10 之间的小数，最多两位（如 9、8.5）'
              : `写回接口的万分比 = ${bp}（10000 = 原价）`
          }
        >
          <Input
            aria-label="折扣"
            value={draft.discountZhe}
            placeholder="9"
            onChange={(e) => patch({ discountZhe: e.target.value })}
          />
        </Field>
        <Field
          label="模型匹配"
          hint="支持 * （全部）、尾部通配 seedance-* 、或精确 model_id。⚠️ 中间带 * 匹配不到任何东西"
        >
          <Input
            aria-label="模型匹配"
            value={draft.modelPattern}
            placeholder="* 或 seedance-*"
            onChange={(e) => patch({ modelPattern: e.target.value })}
          />
        </Field>
        <Field label="任务匹配" hint="提交任务时的 type，如 text2video；* = 全部">
          <Input
            aria-label="任务匹配"
            value={draft.taskPattern}
            placeholder="* 或 text2video"
            onChange={(e) => patch({ taskPattern: e.target.value })}
          />
        </Field>
        <Field label="优先级" hint="只影响这一页的显示顺序，不影响优惠比较（同等级取最优惠的那条）">
          <Input
            aria-label="优先级"
            value={draft.priority}
            onChange={(e) => patch({ priority: e.target.value })}
          />
        </Field>
        <Field label="状态" hint="停用 = 不命中（计价侧只认 enabled）；删除则是彻底移掉">
          <Select
            aria-label="状态"
            options={MEMBER_STATUS_OPTIONS}
            value={draft.status}
            onChange={(status) => patch({ status })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Alert tone="warning">
          保存即生效（下次预扣就命中），但<b>不影响已提交未结算的任务</b> ——
          那些任务冻结了自己提交时的折扣。
        </Alert>
      </div>
    </Modal>
  );
}
