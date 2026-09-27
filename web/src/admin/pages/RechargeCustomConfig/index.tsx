/* ============================================
 * RechargeCustomConfig 自定义充值配置（PRD §10.3，模块 B）
 *
 * 数据源 GET/PUT /api/admin/recharge-custom-config（**单行配置**，只有读与保存）。
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件** —— 与 RechargePlans /
 * MemberDiscounts 同一条纪律：页面只描述结构，样式一处定义在套件里。
 *
 * ── 这一页最要紧的一句话：这里的「每元积分数」不是消费锚点 ──────────────────────
 *
 * 页面上有两个都叫「1 元 = N 积分」的东西，它们**没有任何关系**：
 *   · 本页的 `credits_per_yuan`：**自定义充值的报价兑换率**，价格 = 积分数 ÷ 它，
 *     只影响这一个购买入口；
 *   · 定价目录里的消费锚点（生成任务计价用）：与充值无关。
 * 不写清这一条，运营改完这里的数就会去问「为什么生成任务的价格没变」（或反过来）。
 *
 * ── 保存校验是服务端的镜像 ────────────────────────────────────────────────
 *
 * 整除与步长对齐（PRD §7.1「需能被换算比例整除」）在 `customConfig.ts` 里先拦一道，
 * 文案与服务端逐字相同 —— 免得运营点了保存、转一圈、报一个自己早就能看出来的错。
 * ============================================ */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save } from 'lucide-react';
import {
  adminRechargeCustomConfigKeys,
  adminRechargeCustomConfigOptions,
  saveAdminRechargeCustomConfig,
} from '@/api/adminRechargeCustomConfig';
import { isApiError } from '@/api/http';
import { customPriceFen, formatCredits, formatPriceYuan } from '@/lib/customRecharge';
import { TIER_PERMISSION_LABEL } from '../RechargePlans/plan';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Field,
  Hint,
  Input,
  Page,
  PageHeader,
  Select,
  TagInput,
  formGrid,
} from '../../ui';
import {
  MAX_CREDITS_VALID_MONTHS,
  MAX_DENIED_HINT_LENGTH,
  MIN_CREDITS_VALID_MONTHS,
  formFromConfig,
  previewIssue,
  toSaveParams,
  validateCustomConfigForm,
  type CustomConfigForm,
} from './customConfig';

/** 购买权限的选项：枚举与档位**同一套**（PRD §10.3「与固定积分卡一致」），中文名也复用同一份 */
const PERMISSION_OPTIONS = (
  Object.keys(TIER_PERMISSION_LABEL) as (keyof typeof TIER_PERMISSION_LABEL)[]
).map((value) => ({
  value,
  label: value === 'member_tier' ? `${TIER_PERMISSION_LABEL[value]}（阶段 2）` : TIER_PERMISSION_LABEL[value],
}));

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
};

/** 积分 → 展示价（分 → 元字符串）；参数非法时给「—」而不是一个编出来的价 */
function priceLabel(credits: number, creditsPerYuan: number): string {
  if (!Number.isInteger(credits) || credits < 1 || !Number.isInteger(creditsPerYuan) || creditsPerYuan < 1) {
    return '—';
  }
  return `¥${formatPriceYuan(customPriceFen(credits, creditsPerYuan))}`;
}

export default function RechargeCustomConfig() {
  const queryClient = useQueryClient();
  const query = useQuery(adminRechargeCustomConfigOptions());

  const [form, setForm] = useState<CustomConfigForm | null>(null);
  /** 保存成功的一句话（带上服务端回的版本号，运营才知道「这次改动生效了」） */
  const [saved, setSaved] = useState('');
  const [warning, setWarning] = useState('');
  const [actionError, setActionError] = useState('');

  // 数据到位时初始化草稿；保存后再拉一次，拿到的是服务端归一后的权威值（含新版本号）
  useEffect(() => {
    if (query.data) setForm(formFromConfig(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: (values: CustomConfigForm) =>
      saveAdminRechargeCustomConfig(toSaveParams(values)),
    onSuccess: ({ data, warning: warn }) => {
      setActionError('');
      setWarning(warn ?? '');
      setSaved(`已保存，配置版本 v${data.version}`);
      // 直接用回包写缓存：省一次 GET，且展示的一定是刚存下的那一份
      queryClient.setQueryData(adminRechargeCustomConfigKeys.all, data);
    },
    onError: (error) => {
      setSaved('');
      setWarning('');
      setActionError(isApiError(error) ? error.message : '保存失败，请稍后重试');
    },
  });

  const handleSave = () => {
    if (form === null || save.isPending) return;
    setSaved('');
    setWarning('');
    const invalid = validateCustomConfigForm(form);
    if (invalid) {
      setActionError(invalid);
      return;
    }
    setActionError('');
    save.mutate(form);
  };

  const patch = (next: Partial<CustomConfigForm>) =>
    setForm((prev) => (prev === null ? prev : { ...prev, ...next }));

  return (
    <Page>
      <PageHeader
        title={
          <>
            自定义充值{' '}
            <Hint title="这一页的两个「1 元 = N 积分」不是一回事">
              <div>
                <b>本页的「每元积分数」只管自定义充值的报价</b>
                价格 = 积分数 ÷ 它。改它只影响这一个入口报出的价，<b>不影响生成任务的计价</b>。
              </div>
              <div>
                <b>生成任务按定价目录里的「消费锚点」计价</b>
                那是另一个数（当前 1 元 = 15 积分），在「系统管理 → 计费目录」那一侧维护。
                两者看到不一样是正常的，<b>不要把它们统一起来</b>。
              </div>
              <div>
                <b>档位（固定积分卡）的到账积分是各档自己配的</b>
                与任何换算率都不成比例，所以本页的数字同样不影响那些卡片。
              </div>
            </Hint>
          </>
        }
        subtitle="用户可自选积分数购买（PRD §7.2）；保存即生效于新订单，已支付订单按其下单单据为准"
        extra={
          <>
            <Button
              icon={<RefreshCw size={16} strokeWidth={2} />}
              disabled={query.isFetching || save.isPending}
              onClick={() => {
                setSaved('');
                setWarning('');
                setActionError('');
                void query.refetch();
              }}
            >
              重新加载
            </Button>
            <Button
              variant="primary"
              icon={<Save size={16} strokeWidth={2} />}
              disabled={form === null || save.isPending}
              onClick={handleSave}
            >
              {save.isPending ? '保存中…' : '保存'}
            </Button>
          </>
        }
      />

      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {warning && <Alert tone="warning">{warning}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}

      {/* 「现在是什么」保持可见（说明性/为什么才收进 ? ） */}
      {query.data && (
        <Alert tone="info" title="当前生效">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Badge tone={query.data.enabled ? 'success' : 'neutral'} dot>
              {query.data.enabled ? '已启用（用户侧展示）' : '已停用（用户侧不展示）'}
            </Badge>
            <span>配置版本 v{query.data.version}</span>
            <span>最后保存 {fmtTime(query.data.updatedAt)}</span>
            <span>
              购买权限：{query.data.permissionLabel ?? TIER_PERMISSION_LABEL[query.data.permission]}
            </span>
          </div>
        </Alert>
      )}

      {query.isPending && <Empty message="加载中…" />}
      {query.isError && (
        <Empty
          message={isApiError(query.error) ? query.error.message : '获取自定义充值配置失败'}
          extra={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}

      {form !== null && (
        <>
          <DraftSummary form={form} />

          <Card title="报价与范围">
            <div style={formGrid(3)}>
              <Field label="最低积分" hint="须能被每元积分数整除，否则最低价不是一个整分">
                <Input
                  aria-label="最低积分"
                  value={form.minCredits}
                  onChange={(e) => patch({ minCredits: e.target.value })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label="最高积分" hint="滑杆的上界，也须能被每元积分数整除">
                <Input
                  aria-label="最高积分"
                  value={form.maxCredits}
                  onChange={(e) => patch({ maxCredits: e.target.value })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label="默认积分" hint="用户打开时的初始值，须落在上下限之间（默认 600 = ¥40）">
                <Input
                  aria-label="默认积分"
                  value={form.defaultCredits}
                  onChange={(e) => patch({ defaultCredits: e.target.value })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field
                label="每元积分数"
                hint={`只影响自定义充值的报价（价格 = 积分数 ÷ 它）。⚠️ 与消费锚点「1 元 = 15 积分」（生成任务计价）不是一个数，改它不会改生成任务的价格`}
                info={
                  <div>
                    <div>
                      这是<b>本入口自己的</b>兑换率，唯一的使用处就是上面那条价格公式。
                    </div>
                    <div>
                      与「系统管理 → 计费目录」里那条消费锚点没有任何关系：那个数管的是生成任务按量扣多少积分。
                      两个数不一样是设计如此，不要为了「看起来一致」去改成同一个值。
                    </div>
                  </div>
                }
              >
                <Input
                  aria-label="每元积分数"
                  value={form.creditsPerYuan}
                  onChange={(e) => patch({ creditsPerYuan: e.target.value })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field
                label="积分步长"
                hint="滑杆与手输的步进；上下限之差、默认值与最低值之差都要是它的整数倍（推不到的最高值是假承诺）"
              >
                <Input
                  aria-label="积分步长"
                  value={form.stepCredits}
                  onChange={(e) => patch({ stepCredits: e.target.value })}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field
                label="积分有效期（月）"
                hint={`${MIN_CREDITS_VALID_MONTHS}–${MAX_CREDITS_VALID_MONTHS}，默认 24 = 2 年；自支付成功时刻起算`}
              >
                <Input
                  aria-label="积分有效期（月）"
                  value={form.creditsValidMonths}
                  onChange={(e) => patch({ creditsValidMonths: e.target.value })}
                  style={{ width: '100%' }}
                />
              </Field>
            </div>

            <div style={{ marginTop: 'var(--admin-space-4)' }}>
              <Checkbox
                checked={form.enabled}
                onChange={(enabled) => patch({ enabled })}
                label="启用自定义充值（关闭后用户侧不展示该入口，下单也会被拒）"
              />
            </div>
          </Card>

          <Card title="购买权限">
            <div style={formGrid(2)}>
              <Field
                label="购买权限"
                hint="枚举与固定积分卡同一套"
                info={
                  <div>
                    <div>「指定会员等级」为阶段 2 预留，本阶段不生效 —— 选了不会拦人，也不会放行。</div>
                    <div>权限改动只影响后续购买判断，不影响已支付订单。</div>
                  </div>
                }
              >
                <Select
                  aria-label="购买权限"
                  options={PERMISSION_OPTIONS}
                  value={form.permission}
                  onChange={(permission) =>
                    patch({ permission: permission as CustomConfigForm['permission'] })
                  }
                />
              </Field>
              <Field label="无权限提示（选填）" hint={`用户无权限时展示；留空用服务端默认文案，最长 ${MAX_DENIED_HINT_LENGTH} 字`}>
                <Input
                  aria-label="无权限提示"
                  value={form.permissionDeniedHint}
                  placeholder="如 该活动仅限内测用户"
                  onChange={(e) => patch({ permissionDeniedHint: e.target.value })}
                  style={{ width: '100%' }}
                />
              </Field>
            </div>

            {form.permission === 'user_group' && (
              <div style={{ ...formGrid(1), marginTop: 'var(--admin-space-4)' }}>
                <Field
                  label="权限白名单（userId）"
                  hint="名单外一律不可购买；名单为空 = 谁都不能买（这是显式配置，不做兜底放行）"
                  info={
                    <div>
                      <div>
                        元素按十进制字符串存：userId 是 BigInt，转成数字会丢精度，错一位就是放进来一个陌生人。
                      </div>
                      <div>逐个添加，回车或点「添加」。</div>
                    </div>
                  }
                >
                  <TagInput
                    values={form.permissionAllowlist}
                    onChange={(permissionAllowlist) => patch({ permissionAllowlist })}
                    placeholder="userId，如 9001"
                    ariaLabel="添加白名单用户"
                    maxLength={19}
                  />
                </Field>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

/**
 * 草稿摘要：把「现在填的这组数会报出什么价」摊开。
 *
 * <p>它是**可见的**而不是收进 ? 里：运营填完六个数字最需要立刻确认的就是「600 积分到底多少钱」，
 * 而这正是点保存之前唯一值得看一眼的东西。
 */
function DraftSummary({ form }: { form: CustomConfigForm }) {
  const issue = previewIssue(form);
  const min = Number(form.minCredits);
  const max = Number(form.maxCredits);
  const def = Number(form.defaultCredits);
  const rate = Number(form.creditsPerYuan);

  return (
    <Alert tone={issue === null ? 'info' : 'warning'} title="按当前填写">
      {issue !== null ? (
        issue
      ) : (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>
            范围：{formatCredits(min)} – {formatCredits(max)} 积分（
            {priceLabel(min, rate)} – {priceLabel(max, rate)}）
          </span>
          <span>
            默认：{formatCredits(def)} 积分 = {priceLabel(def, rate)}
          </span>
        </div>
      )}
    </Alert>
  );
}
