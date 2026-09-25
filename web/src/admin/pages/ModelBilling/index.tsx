/* ============================================
 * ModelBilling 模型计费：定价目录的查看与整份发布
 *
 * 数据源 GET/POST /api/admin/billing-catalog（后端转发 billing 的管理端接口）。
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**。
 *
 * ── 这一页为什么是「整份发布」而不是「逐行保存」 ─────────────────────────────────
 *
 * billing 的定价目录是**一个版本 = 一份 JSON**：`document_hash` 与内容一一对应，
 * job 提交时冻结 `catalog_version`，结算按冻结版本复现（见 SettlementService）。
 * 所以行级增量发布在这里不是可选项：没有版本边界，改价就会影响到已提交的任务。
 * 界面上表现为「改完点保存 = 发布一整份新目录」，因此三件事必须说清楚：
 *
 *   1. **保存的是整份**（不是这一行）：提示条里写明；并发编辑时后保存者整份覆盖先保存者；
 *   2. **当前生效版本**摆在页头：让人能看出「我手里这份是不是最新的」；
 *   3. **没有改动就不发版**：比对解析后的对象（不是读回来的文本 —— 那是 MySQL 规范化过的
 *      形态），否则点一次保存就多出一个内容相同的版本，历史里再也看不出「这版是谁改的」。
 *
 * ── 单位：为什么界面上是 mc ───────────────────────────────────────────────────
 *
 * 基准单价在目录里是 **mc**（1 积分 = 1000 mc），本页就按 mc 编辑，旁边实时给出
 * 「N 积分 ≈ ¥X.XX」。不改成「让用户填元」是因为 mc ↔ 元的换算几乎永远不是整数：
 * creditsPerYuan=15 时 100000 mc = ¥6.666666666666667 —— 界面只能是长小数或四舍五入，
 * 而**没被改动的字段也会被写回**，一次改 A 的保存会顺手把 B 的价格挪动几 mc。
 * 改的是钱，且没人看得见。mc 是这里唯一「齐整」的单位。
 * ============================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import {
  billingCatalogKeys,
  billingCatalogOptions,
  publishBillingCatalog,
  type BillingCatalog,
} from '@/api/adminBillingCatalog';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import {
  BASE_UNIT_OPTIONS,
  bpToMultiple,
  describeBasePrice,
  describePriceInHuman,
  emptyRuleForm,
  formFromRule,
  isCatalogDirty,
  listRules,
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
  type CatalogDocumentJson,
  type CatalogRuleView,
  type KeyValueRow,
  type RuleForm,
} from './catalogDraft';
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Table,
} from '../../ui';

const ROUNDING_OPTIONS = [
  { value: 'halfUp', label: 'halfUp（四舍五入，默认）' },
  { value: 'ceil', label: 'ceil（向上取整，偏向平台）' },
  { value: 'floor', label: 'floor（向下取整，偏向用户）' },
];

const STACK_MODE_OPTIONS = [
  { value: 'multiply', label: 'multiply（会员再享活动）' },
  { value: 'best', label: 'best（两者取优）' },
];

/** 编辑弹窗要用的初始状态。 */
interface RuleEditorState {
  initial: RuleForm;
  /** 改动前的那条规则：本页不编辑的字段（usageSemantic / by）从它原样带过去 */
  original: CatalogRuleView;
  /** 已有规则不能改键：模型 / 任务类型是 models 映射的键，改键等于挪位置 */
  isNew: boolean;
}

export default function ModelBilling() {
  const queryClient = useQueryClient();
  const catalog = useQuery(billingCatalogOptions());

  /** 已加载的版本信息 + 它对应的解析结果（基线）。只在「加载 / 重新加载 / 发布成功」三处变。 */
  const [loaded, setLoaded] = useState<{
    meta: BillingCatalog;
    baseline: CatalogDocumentJson;
  } | null>(null);
  const [draft, setDraft] = useState<CatalogDocumentJson | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [published, setPublished] = useState('');
  const [editor, setEditor] = useState<RuleEditorState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ modelId: string; taskType: string } | null>(
    null,
  );
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState('');

  const adopt = useCallback((meta: BillingCatalog) => {
    const parsed = parseCatalog(meta.document);
    setLoaded({ meta, baseline: parsed });
    setDraft(parsed);
    setNotice('');
  }, []);

  // ⚠️ 只在**首次**拿到数据时建草稿：react-query 的任何一次 refetch 都会换掉 `data` 的引用，
  //    跟着它重建草稿会把用户正在编辑的内容无声冲掉。（重新加载与发布走各自的显式路径。）
  useEffect(() => {
    if (loaded !== null || catalog.data === undefined) return;
    try {
      adopt(catalog.data);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '目录文档解析失败');
    }
  }, [catalog.data, loaded, adopt]);

  const publish = useMutation({
    mutationFn: publishBillingCatalog,
    onSuccess: (result) => {
      // 发布成功 = 服务端现在生效的就是这份草稿：把它当作新基线
      setLoaded((prev) =>
        prev === null
          ? prev
          : {
              meta: {
                ...prev.meta,
                catalogVersion: result.catalogVersion,
                documentHash: result.documentHash,
                ruleCount: result.ruleCount,
                creditsPerYuan: result.creditsPerYuan,
              },
              baseline: draft ?? prev.baseline,
            },
      );
      setPublished(
        `已发布 v${result.catalogVersion}（${result.ruleCount} 条规则，1 元 = ${result.creditsPerYuan} 积分），立即生效`,
      );
      setActionError('');
      setPublishOpen(false);
      setNote('');
      // 缓存里还是发布前那份；不清掉的话，离开再回来会拿旧的版本号（内容其实一样）
      void queryClient.invalidateQueries({ queryKey: billingCatalogKeys.all });
    },
    onError: (error) => {
      // 文档被拒（400）与 billing 不可用（503）的文案都由后端给出，原样呈现
      setActionError(isApiError(error) ? error.message : '发布失败，请稍后重试');
    },
  });

  const reload = useCallback(async () => {
    setReloadConfirm(false);
    setActionError('');
    const result = await catalog.refetch();
    if (result.data === undefined) {
      setNotice(isApiError(result.error) ? result.error.message : '重新加载失败');
      return;
    }
    try {
      adopt(result.data);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '目录文档解析失败');
    }
  }, [catalog, adopt]);

  const rows = useMemo(() => (draft === null ? [] : listRules(draft)), [draft]);
  const creditsPerYuan = draft === null ? null : readCreditsPerYuan(draft);
  const dirty = draft !== null && loaded !== null && isCatalogDirty(draft, loaded.baseline);

  // 首屏 / 加载失败 / 文档解析失败。⚠️ 三种状态的区分是有意的：
  // 「取不到目录」与「目录读不出来」都只该让人重试，不该把页面渲染成一份空目录 ——
  // 那会让人以为线上真的没有规则，然后拿一份空文档去发布。
  if (catalog.isPending || loaded === null || draft === null) {
    const failure = catalog.isError
      ? isApiError(catalog.error)
        ? catalog.error.message
        : '获取定价目录失败'
      : notice;
    return (
      <Page>
        <PageHeader title="模型计费" subtitle="查看并修改定价目录（整份发布）" />
        {failure ? (
          <Alert tone="danger">
            {failure}
            <div style={{ marginTop: 8 }}>
              <Button onClick={() => void reload()}>重试</Button>
            </div>
          </Alert>
        ) : (
          <Empty message="加载中…" />
        )}
      </Page>
    );
  }

  const meta = loaded.meta;
  const isFirstPublish = meta.catalogVersion === -1;

  return (
    <Page>
      <PageHeader
        title="模型计费"
        subtitle={
          isFirstPublish
            ? '还没有生效的定价目录 —— 保存后会发布第 1 版并立即生效'
            : `当前生效 v${meta.catalogVersion}（内容指纹 ${meta.documentHash.slice(0, 8)}）· ${meta.ruleCount} 条规则`
        }
        extra={
          <>
            <Button
              icon={<RefreshCw size={16} strokeWidth={2} />}
              disabled={catalog.isFetching}
              onClick={() => (dirty ? setReloadConfirm(true) : void reload())}
            >
              重新加载
            </Button>
            <Button
              variant="primary"
              disabled={!dirty}
              title={dirty ? undefined : '没有任何改动'}
              onClick={() => setPublishOpen(true)}
            >
              保存并发布
            </Button>
          </>
        }
      />

      {notice && <Alert tone="danger">{notice}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {published && <Alert tone="success">{published}</Alert>}
      {dirty && (
        <Alert tone="warning">
          有未发布的改动。不点「保存并发布」，这些改动不会生效；离开这一页也会丢掉。
        </Alert>
      )}

      {/* ⚠️ 这两条是这一页最容易被误解的地方，所以放在最上面而不是藏进说明文档 */}
      <Alert tone="info" title="保存的是整份目录，不是这一行">
        点「保存并发布」会把下面这份完整内容作为一个新版本发布并立即生效，当前版本降级为历史版本。
        两个人同时编辑时，后保存的那份会整份覆盖先保存的那份 —— 保存前确认页头的「当前生效版本」
        还是你打开时的那个；不是就点「重新加载」。
      </Alert>

      <Alert tone="info" title={`1 元 = ${creditsPerYuan ?? '—'} 积分（换算率）`}>
        改这个值不影响已提交的任务：任务的价按目录里的 mc 单价算，结算按任务冻结的版本复现，
        换算率根本不参与生成计价。已下单的充值也不受影响（到账积分在下单时刻就冻结进订单了）。
        它改变的是之后新的充值订单能换到多少积分 —— 用户看到的「¥100 = N 积分」会立刻按新值算。
      </Alert>

      {/* 目录级设置 */}
      <Card title="目录设置">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px 24px' }}>
          <NumberField
            label="换算率：1 元 = 多少积分"
            ariaLabel="1 元 = 多少积分"
            hint="合法区间 1 ~ 100000。改它只影响之后新的充值订单（见上面的说明）"
            value={creditsPerYuan}
            allowNull
            onChange={(next) =>
              setDraft((d) => (d === null ? d : withCreditsPerYuan(d, next)))
            }
          />
          <Field label="折扣叠加方式" hint="会员折扣与营销活动同时命中时怎么叠加">
            <Select
              aria-label="折扣叠加方式"
              options={STACK_MODE_OPTIONS}
              value={readDiscountPolicy(draft).stackMode}
              onChange={(stackMode) =>
                setDraft((d) => (d === null ? d : withDiscountPolicy(d, { stackMode })))
              }
            />
          </Field>
          <NumberField
            label="折扣底线（万分比）"
            ariaLabel="折扣底线"
            hint="万分比，10000 = 不打折。留空 = 用默认 3000（不填也不会变成「不设底线」）"
            value={readDiscountPolicy(draft).floorFactorBp}
            onChange={(next) =>
              setDraft((d) =>
                d === null || next === null ? d : withDiscountPolicy(d, { floorFactorBp: next }),
              )
            }
          />
        </div>
      </Card>

      {/* 规则表 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '4px 0' }}>
        <Button
          icon={<Plus size={16} strokeWidth={2} />}
          onClick={() => setEditor({ initial: emptyRuleForm(), original: {}, isNew: true })}
        >
          新增规则
        </Button>
      </div>

      <Table>
        <thead>
          <tr>
            <th>模型</th>
            <th>任务类型</th>
            <th>基准维度</th>
            <th>基准单价</th>
            <th>单位分母</th>
            <th>积分下限 / 上限</th>
            <th>舍入</th>
            <th>附加维度 / 倍率</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9}>
                <Empty
                  message="还没有任何计价规则"
                  extra={
                    <Button
                      variant="primary"
                      onClick={() =>
                        setEditor({ initial: emptyRuleForm(), original: {}, isNew: true })
                      }
                    >
                      新增规则
                    </Button>
                  }
                />
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={`${row.modelId}/${row.taskType}`}>
              <td>{row.modelId}</td>
              <td>{row.taskType}</td>
              <td>{formatText(row.rule.baseUnit)}</td>
              <td>
                <BasePriceCell rule={row.rule} creditsPerYuan={creditsPerYuan} />
              </td>
              <td>{formatCell(row.rule.unitDenominator)}</td>
              <td>
                {formatCell(row.rule.minCredits)} / {formatCell(row.rule.maxCredits)}
              </td>
              <td>{formatRounding(row.rule.rounding)}</td>
              <td>
                <WeightsCell rule={row.rule} />
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="编辑"
                    aria-label="编辑"
                    icon={<Pencil size={15} strokeWidth={2} />}
                    onClick={() =>
                      setEditor({
                        initial: formFromRule(row.modelId, row.taskType, row.rule),
                        original: row.rule,
                        isNew: false,
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    title="删除"
                    aria-label="删除"
                    icon={<Trash2 size={15} strokeWidth={2} />}
                    onClick={() => setDeleteTarget({ modelId: row.modelId, taskType: row.taskType })}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {editor !== null && (
        <RuleEditorModal
          state={editor}
          creditsPerYuan={creditsPerYuan}
          onClose={() => setEditor(null)}
          // ⚠️ 模型 / 任务类型是 models 映射的**键**，所以由弹窗把表单里最终的这两个值回传，
          //    而不是页面从 `state.initial` 里取：新建时用户正是在弹窗里填的它们，
          //    取 initial 会拿到空串，规则就落到一个空模型键上。
          onSave={(rule, modelId, taskType) => {
            setDraft((d) => (d === null ? d : withRule(d, modelId, taskType, rule)));
            setEditor(null);
            setPublished('');
          }}
        />
      )}

      {deleteTarget !== null && (
        <ConfirmModal
          title="删除计价规则"
          content={`删除 ${deleteTarget.modelId} / ${deleteTarget.taskType} 后，这个组合会算不出价（提交任务时会被拒绝）。改动要等「保存并发布」才生效。`}
          confirmText="删除"
          onConfirm={() => {
            setDraft((d) =>
              d === null ? d : withoutRule(d, deleteTarget.modelId, deleteTarget.taskType),
            );
            setDeleteTarget(null);
            setPublished('');
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {reloadConfirm && (
        <ConfirmModal
          title="重新加载"
          content="有未发布的改动，重新加载会丢弃它们、回到线上当前生效的版本。"
          confirmText="丢弃改动并重新加载"
          onConfirm={() => void reload()}
          onClose={() => setReloadConfirm(false)}
        />
      )}

      {publishOpen && (
        <Modal
          open
          title="发布整份目录"
          width={560}
          onClose={() => setPublishOpen(false)}
          footer={
            <>
              <Button onClick={() => setPublishOpen(false)}>取消</Button>
              <Button
                variant="primary"
                disabled={publish.isPending}
                onClick={() =>
                  publish.mutate({
                    document: serializeCatalog(draft),
                    ...(note.trim() ? { note: note.trim() } : {}),
                  })
                }
              >
                {publish.isPending ? '发布中…' : '确认发布'}
              </Button>
            </>
          }
        >
          <Alert tone="warning">
            会把下面这份完整内容作为一个新版本发布，覆盖当前生效版本
            {meta.catalogVersion === -1 ? '（当前没有生效版本）' : `（v${meta.catalogVersion}）`}
            ，立即对所有新提交的任务生效。已提交的任务不受影响 —— 它们冻结了自己的版本。
          </Alert>
          <div style={{ marginTop: 12 }}>
            <Field label="备注（选填）" hint="写清这次改了什么；目录行会记下发布人、时间与这句备注">
              <Input
                aria-label="发布备注"
                value={note}
                placeholder="例如：seedance 2.5 单价下调 10%"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            本次发布：{rows.length} 条规则，1 元 = {creditsPerYuan ?? '—'} 积分。
          </div>
        </Modal>
      )}
    </Page>
  );
}

/* ============ 表格里的小呈现 ============ */

function formatCell(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

/** 文本列（基准维度）：空串与缺失都显示「—」，不留一格空白。 */
function formatText(value: unknown): string {
  return typeof value === 'string' && value ? value : '—';
}

/** 舍入：文档没写时显示 billing 的默认 `halfUp` —— 那是实际会发生的事，不是我们的猜测。 */
function formatRounding(value: unknown): string {
  return typeof value === 'string' && value ? value : 'halfUp（默认）';
}

/** 基准单价：mc 原文 + 人类可读的换算（价格表逐档列出）。 */
function BasePriceCell({
  rule,
  creditsPerYuan,
}: {
  rule: CatalogRuleView;
  creditsPerYuan: number | null;
}) {
  const price = rule.basePrice ?? {};
  if (price.kind === 'table') {
    const table = price.table ?? {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div>{describeBasePrice(rule)}</div>
        {Object.entries(table).map(([key, value]) =>
          typeof value === 'number' ? (
            <div key={key} style={{ fontSize: 12 }}>
              {key} → {describePriceInHuman(value, creditsPerYuan)}
            </div>
          ) : null,
        )}
      </div>
    );
  }
  if (typeof price.value !== 'number') return <span>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div>{describeBasePrice(rule)}</div>
      <div style={{ fontSize: 12 }}>{describePriceInHuman(price.value, creditsPerYuan)}</div>
    </div>
  );
}

/** 附加维度与整单倍率：万分比原文 + 倍数（4000 = 0.4 倍，10000 = 1 倍）。 */
function WeightsCell({ rule }: { rule: CatalogRuleView }) {
  const lines = [
    ...Object.entries(rule.dims ?? {}).map(
      ([key, value]) => `维度 ${key}=${String(value)}（${bpToMultiple(Number(value))} 倍）`,
    ),
    ...Object.entries(rule.multipliers ?? {}).map(
      ([key, value]) => `倍率 ${key}=${String(value)}（${bpToMultiple(Number(value))} 倍）`,
    ),
  ];
  if (lines.length === 0) return <span>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {lines.map((line) => (
        <div key={line} style={{ fontSize: 12 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

/* ============ 整数输入框 ============ */

/**
 * 整数输入：内部存**文字**，只在能解析成整数时往外抛。
 *
 * <p>为什么不能直接用 `value={String(数字)}` 的受控输入：那样用户永远清不空这个框
 * （清空 = 非法 = 立刻被写成原值弹回来），而「全选删掉再输」是最常见的改数方式。
 * 所以文字留在本组件里，外面拿到的永远是合法整数。
 *
 * @param allowNull 允许「空」这个状态（清空时往外抛 null）。用于换算率这种**必须填**的字段：
 *                  空着就是空着，交给 billing 的编译期报错说清楚，而不是在这里悄悄补一个数。
 */
function NumberField({
  label,
  ariaLabel,
  hint,
  value,
  onChange,
  allowNull = false,
}: {
  label: string;
  ariaLabel: string;
  hint: string;
  value: number | null;
  onChange: (value: number | null) => void;
  allowNull?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));

  // 外部值变了（重新加载 / 换成另一份目录）才回写文字；用户自己敲的空串不会被这里弹回去
  useEffect(() => {
    setText(value === null ? '' : String(value));
  }, [value]);

  return (
    <Field label={label} hint={hint}>
      <Input
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => {
          const raw = e.target.value.trim();
          setText(e.target.value);
          if (raw === '') {
            if (allowNull) onChange(null);
            return;
          }
          if (!/^\d+$/.test(raw)) return;
          onChange(Number(raw));
        }}
      />
    </Field>
  );
}

/* ============ 规则编辑弹窗 ============ */

function RuleEditorModal({
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
        <Field label="计价方式" hint="常数单价，或按规格查表（例如按分辨率定价）">
          <Select
            aria-label="计价方式"
            options={[
              { value: 'const', label: 'const（常数单价）' },
              { value: 'table', label: 'table（按规格查表）' },
            ]}
            value={form.priceKind}
            onChange={(v) => patch({ priceKind: v === 'table' ? 'table' : 'const' })}
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
        ) : (
          <Field
            label="价格表（规格键 → 单价 mc）"
            hint="规格键与提交时的规格一致（例如 size=2k）；键不区分大小写，等价键重复会被拒绝"
          >
            <KeyValueEditor
              rows={form.priceTable}
              ariaPrefix="价格表"
              keyPlaceholder="size=2k"
              valuePlaceholder="100000"
              onChange={(priceTable) => patch({ priceTable })}
            />
          </Field>
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
          onClick={() => onChange([...rows, { key: '', value: '' }])}
        >
          添加一行
        </Button>
      </div>
    </div>
  );
}
