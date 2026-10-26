import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, RefreshCw } from 'lucide-react';
import {
  mediaToolPricingKeys,
  mediaToolPricingOptions,
  updateMediaToolPricing,
  type MediaToolPricing,
} from '@/admin/api/adminMediaToolPricing';
import { isApiError } from '@/shared/api/http';
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
  Modal,
  Page,
  PageHeader,
  Table,
  Textarea,
} from '../../ui';
import { describePricing, parsePricingDraft, pricingEditorText } from './pricingDraft';

interface EditorState {
  row: MediaToolPricing;
  label: string;
  enabled: boolean;
  chargeEnabled: boolean;
  pricingText: string;
}

function editorFrom(row: MediaToolPricing): EditorState {
  return {
    row,
    label: row.label,
    enabled: row.enabled,
    chargeEnabled: row.charge_enabled,
    pricingText: pricingEditorText(row.pricing),
  };
}

export default function ToolPricing() {
  const queryClient = useQueryClient();
  const list = useQuery(mediaToolPricingOptions());

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState('');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: mediaToolPricingKeys.all });

  const save = useMutation({
    mutationFn: ({
      toolType,
      label,
      enabled,
      chargeEnabled,
      pricing,
    }: {
      toolType: string;
      label: string;
      enabled: boolean;
      chargeEnabled: boolean;
      pricing: Record<string, unknown>;
    }) =>
      updateMediaToolPricing(toolType, {
        label,
        enabled,
        charge_enabled: chargeEnabled,
        pricing,
      }),
    onSuccess: (row) => {
      setEditor(null);
      setFormError('');
      const state = !row.enabled
        ? '当前已停用，用户无法提交该工具。'
        : !row.charge_enabled
          ? '当前不计费，提交不扣积分。'
          : '新提交的任务按新规则计费。';
      setSaved(`已保存「${row.label}」，版本 ${row.version}；${state}`);
      void invalidate();
    },
    onError: (error) => {
      setFormError(isApiError(error) ? error.message : '保存失败，请稍后重试');
    },
  });

  const rows = list.data ?? [];

  const submitEditor = () => {
    if (editor === null) return;
    const label = editor.label.trim();
    if (!label) {
      setFormError('工具名称不能为空');
      return;
    }
    if (label.length > 64) {
      setFormError('工具名称不能超过 64 个字符');
      return;
    }
    const pricing = parsePricingDraft(editor.pricingText);
    if (!pricing.ok) {
      setFormError(pricing.error);
      return;
    }
    setFormError('');
    save.mutate({
      toolType: editor.row.tool_type,
      label,
      enabled: editor.enabled,
      chargeEnabled: editor.chargeEnabled,
      pricing: pricing.value,
    });
  };

  return (
    <Page>
      <PageHeader
        title={
          <>
            工具计费{' '}
            <Hint title="这一页改什么">
              <div>
                <b>保存后版本 +1，新提交的任务生效。</b>
                已提交的任务在提交时冻结了当时的计价规则，不会因这次修改重算。
              </div>
              <div>
                <b>计价规则是 JSON，字段随工具能力走。</b>
                按秒计费用 <code>usage.seconds</code> + <code>unitDenominator</code>；
                分档价用 <code>basePrice.kind=table</code>。改完保存会由服务端校验。
              </div>
            </Hint>
          </>
        }
        subtitle="维护 MediaKit 工具的计价规则；关闭计费后提交不再扣积分"
        extra={
          <Button
            icon={<RefreshCw size={16} strokeWidth={2} />}
            disabled={list.isFetching}
            onClick={() => {
              setSaved('');
              void list.refetch();
            }}
          >
            重新加载
          </Button>
        }
      />

      {saved && <Alert tone="success">{saved}</Alert>}

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <th>工具</th>
              <th>当前计价</th>
              <th>版本</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.isPending && (
              <tr>
                <td colSpan={6}>
                  <Empty message="加载中…" />
                </td>
              </tr>
            )}
            {list.isError && (
              <tr>
                <td colSpan={6}>
                  <Empty
                    message={isApiError(list.error) ? list.error.message : '获取工具计价失败'}
                    extra={<Button onClick={() => void list.refetch()}>重试</Button>}
                  />
                </td>
              </tr>
            )}
            {!list.isPending && !list.isError && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <Empty message="还没有配置任何工具计价" />
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.tool_type}>
                <td>
                  <b>{row.label}</b>
                  <div style={{ fontSize: 'var(--admin-font-xs)' }}>{row.tool_type}</div>
                </td>
                <td>{describePricing(row.pricing)}</td>
                <td>v{row.version}</td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--admin-space-1)', flexWrap: 'wrap' }}>
                    <Badge tone={row.enabled ? 'success' : 'neutral'} dot>
                      {row.enabled ? '启用' : '停用'}
                    </Badge>
                    <Badge tone={row.charge_enabled ? 'accent' : 'warning'} dot>
                      {row.charge_enabled ? '计费' : '不计费'}
                    </Badge>
                  </div>
                </td>
                <td>{row.updated_at.replace('T', ' ').slice(0, 16)}</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="编辑"
                    aria-label={`编辑 ${row.label} 的计价`}
                    icon={<Pencil size={15} strokeWidth={2} />}
                    onClick={() => {
                      setFormError('');
                      setSaved('');
                      setEditor(editorFrom(row));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Modal
        open={editor !== null}
        title={editor === null ? '编辑工具计价' : `编辑：${editor.row.label}`}
        width={680}
        onClose={() => {
          if (!save.isPending) setEditor(null);
        }}
        footer={
          <>
            <Button disabled={save.isPending} onClick={() => setEditor(null)}>取消</Button>
            <Button variant="primary" disabled={save.isPending} onClick={submitEditor}>
              {save.isPending ? '保存中…' : '保存'}
            </Button>
          </>
        }
      >
        {editor !== null && (
          <div style={{ display: 'grid', gap: 'var(--admin-space-3)' }}>
            {formError && <Alert tone="danger">{formError}</Alert>}
            <Field label="工具标识" hint={`当前版本 v${editor.row.version}，保存后版本 +1`}>
              <Input value={editor.row.tool_type} readOnly aria-label="工具标识" />
            </Field>
            <Field label="工具名称">
              <Input
                value={editor.label}
                maxLength={64}
                aria-label="工具名称"
                onChange={(event) => setEditor({ ...editor, label: event.target.value })}
              />
            </Field>
            <div style={{ display: 'flex', gap: 'var(--admin-space-4)' }}>
              <Checkbox
                checked={editor.enabled}
                onChange={(enabled) => setEditor({ ...editor, enabled })}
                label="启用工具（关闭后用户无法提交）"
              />
              <Checkbox
                checked={editor.chargeEnabled}
                onChange={(chargeEnabled) => setEditor({ ...editor, chargeEnabled })}
                label="开启计费（关闭后提交不扣积分）"
              />
            </div>
            <Field
              label="计价规则（JSON）"
              hint="basePrice.value 与 table 里的数值单位是 mc（1000 = 1 积分）；minCredits / maxCredits 用积分。保存后版本 +1。"
            >
              <Textarea
                rows={16}
                value={editor.pricingText}
                spellCheck={false}
                aria-label="计价规则 JSON"
                style={{ fontFamily: 'var(--admin-font-mono, monospace)', fontSize: 'var(--admin-font-xs)' }}
                onChange={(event) => setEditor({ ...editor, pricingText: event.target.value })}
              />
            </Field>
            <div style={{ fontSize: 'var(--admin-font-xs)' }}>
              {(() => {
                const draft = parsePricingDraft(editor.pricingText);
                return draft.ok
                  ? `当前描述：${describePricing(draft.value)}`
                  : `无法解析：${draft.error}`;
              })()}
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}
