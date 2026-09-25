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
 * ── 单位：界面按「元」，目录里存 mc ──────────────────────────────────────────
 *
 * 运营手上的是官方价目表上的元（「70 元 / 百万 token」「0.12 元 / 张」），
 * 让他对着 1050000 这种内部数字填，既认不出自己配的是哪一档、也没法照着文档抄。
 * 所以**编辑与展示都用元**（旁边标出量纲：元 / 百万 token、元 / 张、元 / 次），
 * 写回目录的仍然是 mc —— 引擎与账本的单位不动。
 *
 * ⚠️ 换算的那一次舍入有个坑：**没被改动的字段也会被写回**，老老实实「渲染成元 → 解析 → 换回 mc」
 * 会让一次改 A 的保存顺手把 B 的价挪动几个 mc（改的是钱，且没人看得见）。
 * 所以每个价格栏都带着打开表单时读到的原 mc，**文本没动就原值写回** ——
 * 见 `catalogDraft` 的 `MoneyField` 与文件头第 2 条。
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
import NumberField from './NumberField';
import RuleEditorModal, { type RuleEditorState } from './RuleEditorModal';
import {
  bpToMultiple,
  describeBasePrice,
  describePriceInHuman,
  priceUnitLabel,
  describeSpecKey,
  emptyRuleForm,
  formFromRule,
  isCatalogDirty,
  listRules,
  parseCatalog,
  readCreditsPerYuan,
  readDiscountPolicy,
  serializeCatalog,
  withCreditsPerYuan,
  withDiscountPolicy,
  withRule,
  withoutRule,
  type CatalogDocumentJson,
  type CatalogRuleView,
} from './catalogDraft';
import {
  Alert,
  Badge,
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

const STACK_MODE_OPTIONS = [
  { value: 'multiply', label: 'multiply（会员再享活动）' },
  { value: 'best', label: 'best（两者取优）' },
];


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
                        initial: formFromRule(row.modelId, row.taskType, row.rule, creditsPerYuan),
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
  if (price.kind === 'unset') {
    // ⚠️ 这一格的措辞必须说清「不是免费」：运营看到「未配」时最容易的误判是
    //    「还没配=先不收费」，而实际是提交直接失败。
    return <Badge tone="warning">单价未配（提交会被拒绝）</Badge>;
  }
  if (price.kind === 'table') {
    const table = price.table ?? {};
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div>{describeBasePrice(rule, creditsPerYuan)}</div>
        {Object.entries(table).map(([key, value]) =>
          typeof value === 'number' ? (
            <div key={key} style={{ fontSize: 12 }}>
              {describeSpecKey(key)} →{' '}
              {describePriceInHuman(value, creditsPerYuan, priceUnitLabel(rule))}
            </div>
          ) : null,
        )}
      </div>
    );
  }
  if (typeof price.value !== 'number') return <span>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div>{describeBasePrice(rule, creditsPerYuan)}</div>
      <div style={{ fontSize: 12 }}>
        {describePriceInHuman(price.value, creditsPerYuan, priceUnitLabel(rule))}
      </div>
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
  // token 估算参数单列一行摘要 —— 它是「预扣算不算得出」的开关，藏在编辑弹窗里会让人
  // 只看到「单价配了」，却不知道这个模型提交时会不会因为推不出 token 而被拒。
  if (rule.tokenEstimate !== undefined && rule.tokenEstimate !== null) {
    const token = rule.tokenEstimate;
    const dims = token.dimensions ?? {};
    lines.push(
      `token 估算 ${String(token.divisor ?? '—')} / ${String(token.fps ?? '—')}fps` +
        `（${Object.keys(dims).length} 档${token.inputSecondsKey ? '，含输入时长' : ''}）`,
    );
  }
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
