import { Plus, X } from 'lucide-react';
import type { KeyValueRow } from '../../utils/billing-catalog/catalogDraft';
import {
  GPT_PROVIDER_SIZES,
  TASK_TYPE_DURATION_OPTIONS,
  TASK_TYPE_KEYS,
  channelOf,
  type ChannelId,
  type GptMatrix,
  type RatioForm,
  type SizeForm,
  type TaskTypeDurationStrategy,
} from './model-form';
import {
  FEATURE_BOOL_LABELS,
  FEATURE_NUMBER_LABELS,
  FEATURE_STRING_LABELS,
  type ModelType,
} from '@/admin/enums';
import {
  featureApplies,
} from './feature-fields';
import { Badge, Button, Checkbox, Chip, Field, Input, Segmented, Select, Table } from '../../ui';
import DimensionMatrix from './DimensionMatrix';
import { Hint } from '../../ui';
import {
  CHIP_LIST,
  FEATURE_FIELD_GRID,
  FEATURE_FLAG_GRID,
  FEATURE_GROUP_LABEL,
  FEATURE_GROUPS,
  FULL,
  GRID2,
  GRID3,
  INLINE_ROW,
  LABEL,
  PANEL,
  SECTION,
  SIZE_ROW,
} from './formLayout';

interface SizeMaterialTabProps {
  type: ModelType;
  channel: ChannelId;
  gpt: { matrix: GptMatrix; setCell: (sizeId: string, ratio: string, value: string) => void };
  seedream: { matrix: GptMatrix; setCell: (sizeId: string, ratio: string, value: string) => void };
  banana: {
    quality: Record<string, string>;
    setQuality: (value: Record<string, string>) => void;
    size: Record<string, string>;
    setSize: (value: Record<string, string>) => void;
  };
  visible: {
    sizeRatio: boolean;
    duration: boolean;
    defaultDuration: boolean;
    format: boolean;
    structuredFeature: boolean;
  };
  sizes: {
    rows: SizeForm[];
    add: () => void;
    update: (index: number, patch: Partial<SizeForm>) => void;
    remove: (index: number) => void;
  };
  ratios: {
    rows: RatioForm[];
    update: (index: number, patch: Partial<RatioForm>) => void;
    remove: (ratioId: string) => void;
    draft: string;
    setDraft: (value: string) => void;
    add: () => void;
  };
  dimensions: { rows: KeyValueRow[]; candidates: string[] | null; set: (rows: KeyValueRow[]) => void };
  defaults: {
    size: string;
    setSize: (value: string) => void;
    ratio: string;
    setRatio: (value: string) => void;
    format: string;
    setFormat: (value: string) => void;
    duration: string;
    setDuration: (value: string) => void;
  };
  durations: { min: string; max: string; step: string; setMin: (v: string) => void; setMax: (v: string) => void; setStep: (v: string) => void };
  formats: { rows: string[]; remove: (format: string) => void; draft: string; setDraft: (value: string) => void; add: () => void };
  features: {
    flags: Record<string, boolean>;
    toggle: (key: string) => void;
    numbers: Record<string, string>;
    setNumber: (key: string, value: string) => void;
    strings: Record<string, string>;
    setString: (key: string, value: string) => void;
  };
  extraFeatures: {
    entries: Record<string, unknown>;
    remove: (key: string) => void;
  };
  taskTypes: {
    ratios: Record<string, string[]>;
    enabled: Record<string, boolean>;
    toggle: (taskType: string) => void;
    draft: Record<string, string>;
    setDraft: (value: Record<string, string>) => void;
    add: (taskType: string) => void;
    remove: (taskType: string, ratio: string) => void;
    duration: Record<string, TaskTypeDurationStrategy>;
    setDuration: (taskType: string, strategy: TaskTypeDurationStrategy) => void;
  };
}

export default function SizeMaterialTab({
  type,
  channel,
  gpt,
  seedream,
  banana,
  visible,
  sizes,
  ratios,
  dimensions,
  defaults,
  durations,
  formats,
  features,
  extraFeatures,
  taskTypes,
}: SizeMaterialTabProps) {
  const parser = channelOf(channel).parser ?? 'seedream';
  const flagEntries = Object.entries(FEATURE_BOOL_LABELS).filter(([, meta]) => featureApplies(meta, type));
  const numberEntries = Object.entries(FEATURE_NUMBER_LABELS).filter(([, meta]) => featureApplies(meta, type));
  const stringEntries = Object.entries(FEATURE_STRING_LABELS).filter(([, meta]) => featureApplies(meta, type));
  const unrecognisedEntries = Object.entries(extraFeatures.entries);
  const hasUnrecognised = unrecognisedEntries.length > 0;
  return (
    <>
      {visible.sizeRatio && (
        <>
          <h3 style={SECTION}>尺寸选项 <Hint>
            id 既是能力行内部标识，也是<b>出站提交给上游</b>的档位值；展示名只影响界面。
            {type === 'image' && <> 每个档位出站的实际像素由下面「出站尺寸映射」那张表决定。</>}
          </Hint></h3>
          {sizes.rows.map((size, index) => (
            <div style={SIZE_ROW} key={index}>
              <Input
                placeholder="id，如 2k"
                aria-label={`第 ${index + 1} 行尺寸 id`}
                value={size.id}
                onChange={(e) => sizes.update(index, { id: e.target.value })}
                style={FULL}
              />
              <Input
                placeholder="展示名"
                aria-label={`第 ${index + 1} 行展示名`}
                value={size.label ?? ''}
                onChange={(e) => sizes.update(index, { label: e.target.value })}
                style={FULL}
              />
              <Button
                size="sm"
                variant="ghost"
                title="删除尺寸行"
                icon={<X size={14} strokeWidth={2} />}
                onClick={() => sizes.remove(index)}
              />
            </div>
          ))}
          <div style={{ marginBottom: 18 }}>
            <Button icon={<Plus size={14} strokeWidth={2} />} onClick={sizes.add}>
              加一个尺寸行
            </Button>
          </div>

          <h3 style={SECTION}>比例选项 <Hint>
            id 既是能力行内部标识，也是<b>出站提交给上游</b>的比例值；展示名只影响界面。
          </Hint></h3>
          {ratios.rows.map((ratio, index) => (
            <div style={SIZE_ROW} key={index}>
              <Input
                placeholder="id，如 16:9"
                aria-label={`第 ${index + 1} 行比例`}
                value={ratio.id}
                onChange={(e) => ratios.update(index, { id: e.target.value })}
                style={FULL}
              />
              <Input
                placeholder={ratio.id.trim() || '展示名'}
                aria-label={`第 ${index + 1} 行比例展示名`}
                value={ratio.label ?? ''}
                onChange={(e) => ratios.update(index, { label: e.target.value })}
                style={FULL}
              />
              <Button
                size="sm"
                variant="ghost"
                title="删除比例"
                icon={<X size={14} strokeWidth={2} />}
                onClick={() => ratios.remove(ratio.id)}
              />
            </div>
          ))}
          <div style={INLINE_ROW}>
            <Input
              placeholder="如 16:9"
              value={ratios.draft}
              onChange={(e) => ratios.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  ratios.add();
                }
              }}
              style={FULL}
            />
            <Button onClick={ratios.add}>添加比例</Button>
          </div>

          <div style={GRID2}>
            <Field label="默认尺寸">
              <Input value={defaults.size} onChange={(e) => defaults.setSize(e.target.value)} style={FULL} />
            </Field>
            <Field label="默认比例">
              <Input value={defaults.ratio} onChange={(e) => defaults.setRatio(e.target.value)} style={FULL} />
            </Field>
          </div>
        </>
      )}

      {}
      {type === 'image' && (
        <>
          <h3 style={SECTION}>出站尺寸映射（图片 · 执行期查表） <Hint>
            这张表是<b>图片</b>行的<b>执行期</b>在用的：worker 按「分辨率 × 宽高比」在这里
            查出发给上游的尺寸 / 映射。上面那个「渠道」是<b>一个控件管两件事</b>——
            请求字段怎么映射（决定下面显示哪张表：gpt 交叉格 / banana 一维映射 / seedream 像素矩阵，
            <b>换渠道就是换一张表</b>，别把两个族的键混着填）与<b>出站用什么线协议</b>
            （内联图片 / 官方 openai images）。
            两件事绑成一个渠道是有意的：让它们各自自由组合能配出根本不成立的组合
            （banana 一维映射 × 官方协议必然被上游 400），要新组合就加一条渠道选项。
            与视频行的「输出像素表 video_dimensions」不是一张：那张决定视频真正发给上游的
            输出像素，这张决定图片发给上游的尺寸 / 映射。
          </Hint></h3>
          <div style={LABEL}>渠道</div>
          <div>
            <b>{channelOf(channel).label}</b>
            <span>（在「基础」里改）</span>
          </div>

          {}
          {parser === 'gpt' && (
            <div style={{ margin: '12px 0 20px' }}>
              <Table>
                <thead>
                  <tr>
                    <th>
                      比例{' '}
                      <Hint>行=比例选项，列=尺寸选项，格子填官方 size（含 auto）。1K × 16:9 / 9:16 可留空。</Hint>
                    </th>
                    {sizes.rows.map((size) => (
                      <th key={size.id || size.label}>{size.label || size.id || '—'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ratios.rows.map((ratio) => (
                    <tr key={ratio.id}>
                      <td>{ratio.label || ratio.id}</td>
                      {sizes.rows.map((size) => (
                        <td key={size.id || size.label}>
                          <Select
                            size="sm"
                            aria-label={`${ratio.label || ratio.id} 行 ${size.label || size.id} 列`}
                            options={[
                              { value: '', label: '留空' },
                              ...GPT_PROVIDER_SIZES.map((item) => ({ value: item, label: item })),
                            ]}
                            value={gpt.matrix[size.id]?.[ratio.id] ?? ''}
                            onChange={(next) => gpt.setCell(size.id, ratio.id, next)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {parser === 'banana' && (
            <div style={{ margin: '12px 0 20px' }}>
              {}
              <div style={GRID2}>
                <div>
                  <div style={LABEL}>
                    尺寸 → quality{' '}
                    <Hint>一维映射：尺寸选项 → quality；比例选项 → size（如 1x1）。不要填像素交叉格。</Hint>
                  </div>
                  {sizes.rows.map((size) => (
                    <div style={INLINE_ROW} key={size.id}>
                      <Badge tone="neutral">{size.label || size.id}</Badge>
                      <Input
                        placeholder="调用值，如 1k"
                        value={banana.quality[size.id] ?? ''}
                        onChange={(e) => banana.setQuality({ ...banana.quality, [size.id]: e.target.value })}
                        style={FULL}
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <div style={LABEL}>比例 → size</div>
                  {ratios.rows.map((ratio) => (
                    <div style={INLINE_ROW} key={ratio.id}>
                      <Badge tone="neutral">{ratio.label || ratio.id}</Badge>
                      <Input
                        placeholder="调用值，如 1x1"
                        value={banana.size[ratio.id] ?? ''}
                        onChange={(e) => banana.setSize({ ...banana.size, [ratio.id]: e.target.value })}
                        style={FULL}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {}
          {parser === 'seedream' && (
            <div style={{ margin: '12px 0 20px' }}>
              <Table>
                <thead>
                  <tr>
                    <th>
                      比例{' '}
                      <Hint>
                        行=比例选项，列=尺寸选项，格子填出站像素尺寸（如 2048x2048）。
                        worker 按「分辨率 × 宽高比」查这张表换算尺寸；
                        整张清空会让出站尺寸回落成 provider 原值（上游会 400），所以至少保留一格。
                      </Hint>
                    </th>
                    {sizes.rows.map((size) => (
                      <th key={size.id || size.label}>{size.label || size.id || '—'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ratios.rows.map((ratio) => (
                    <tr key={ratio.id}>
                      <td>{ratio.label || ratio.id}</td>
                      {sizes.rows.map((size) => (
                        <td key={size.id || size.label}>
                          <Input
                            size="sm"
                            aria-label={`${ratio.label || ratio.id} 行 ${size.label || size.id} 列`}
                            placeholder="留空"
                            value={seedream.matrix[size.id]?.[ratio.id] ?? ''}
                            onChange={(e) => seedream.setCell(size.id, ratio.id, e.target.value)}
                            style={FULL}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}

      {}
      {type === 'video' && (
        <>
          <h3 style={SECTION}>输出像素表 video_dimensions（视频 · 决定发给上游的输出像素） <Hint>
            这张表与图片行的「出站尺寸映射」不是一张，它是<b>视频</b>行专用的：提交时按
            「分辨率档 × 宽高比」在这里查出输出像素，写进请求的 output_width / output_height
            发给上游。
            行=比例选项，列=尺寸选项，格子填这个组合的输出像素（如 480P × 16:9 → 864x496），
            官方对照表上抄。<b>留空 = 该组合查不到输出像素</b>，提交不会带上宽高。
          </Hint></h3>
          <DimensionMatrix
            sizes={sizes.rows}
            ratios={ratios.rows.map((ratio) => ratio.id)}
            rows={dimensions.rows}
            derived={dimensions.candidates !== null}
            onRows={dimensions.set}
          />
        </>
      )}

      {visible.duration && (
        <>
          <h3 style={SECTION}>时长范围</h3>
          <div style={GRID3}>
            <Field label="最小秒">
              <Input value={durations.min} onChange={(e) => durations.setMin(e.target.value)} style={FULL} />
            </Field>
            <Field label="最大秒">
              <Input value={durations.max} onChange={(e) => durations.setMax(e.target.value)} style={FULL} />
            </Field>
            <Field label="步长（选填）">
              <Input value={durations.step} onChange={(e) => durations.setStep(e.target.value)} style={FULL} />
            </Field>
          </div>
        </>
      )}

      {visible.defaultDuration && (
        <div style={GRID2}>
          <Field label="默认时长（秒）">
            <Input value={defaults.duration} onChange={(e) => defaults.setDuration(e.target.value)} style={FULL} />
          </Field>
        </div>
      )}

      {visible.format && (
        <>
          <h3 style={SECTION}>格式</h3>
          <div style={CHIP_LIST}>
            {formats.rows.map((item) => (
              <Chip key={item} onClick={() => formats.remove(item)}>
                {item} ×
              </Chip>
            ))}
          </div>
          <div style={INLINE_ROW}>
            <Input
              placeholder="如 mp3"
              value={formats.draft}
              onChange={(e) => formats.setDraft(e.target.value)}
              style={FULL}
            />
            <Button onClick={formats.add}>添加格式</Button>
          </div>
          <Field label="默认格式">
            <Input value={defaults.format} onChange={(e) => defaults.setFormat(e.target.value)} style={FULL} />
          </Field>
        </>
      )}

      {}

      {type === 'video' && (
        <>
          <h3 style={SECTION}>视频模式 task_types <Hint>勾选 = 该模式对模型开放；未勾选的模式不出现。比例留空 = 该模式沿用基础「比例选项」。时长策略逐模式配置：指定秒数 = 只能选基础范围；仅自动 = 用户不可选秒数；自动或指定 = 用户可二选一。</Hint></h3>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 168 }}>模式</th>
                <th style={{ width: 190 }}>时长策略</th>
                <th>比例选项</th>
              </tr>
            </thead>
            <tbody>
              {TASK_TYPE_KEYS.map((taskType) => (
                <tr key={taskType}>
                  <td>
                    <Checkbox
                      checked={!!taskTypes.enabled[taskType]}
                      onChange={() => taskTypes.toggle(taskType)}
                      label={taskType}
                    />
                  </td>
                  <td>
                    <Segmented
                      value={taskTypes.duration[taskType] ?? 'specified'}
                      options={TASK_TYPE_DURATION_OPTIONS}
                      onChange={(value) => taskTypes.setDuration(taskType, value)}
                      disabled={!taskTypes.enabled[taskType]}
                      aria-label={`${taskType} 时长策略`}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      {(taskTypes.ratios[taskType] ?? []).map((ratio) => (
                        <Chip key={ratio} onClick={() => taskTypes.remove(taskType, ratio)}>
                          {ratio} ×
                        </Chip>
                      ))}
                      <Input
                        size="sm"
                        placeholder="如 16:9，回车添加"
                        value={taskTypes.draft[taskType] ?? ''}
                        onChange={(e) => taskTypes.setDraft({ ...taskTypes.draft, [taskType]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            taskTypes.add(taskType);
                          }
                        }}
                        style={{ flex: '1 1 150px', minWidth: 0 }}
                      />
                      <Button size="sm" onClick={() => taskTypes.add(taskType)}>添加</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      <h3 style={SECTION}>
        特性 features（结构化） <Hint>开关、数值、文本直接对应 features 里的同名键，留空 = 不写入该键。老数据里形态对不上的键会列在「未识别字段」，可按原样保留或删除。</Hint>
      </h3>
      <div style={PANEL}>
        <div style={FEATURE_GROUPS}>
          {!visible.structuredFeature && (
            <div style={FEATURE_GROUP_LABEL}>该类型的特性键都在下面按类型展示。</div>
          )}
          {flagEntries.length > 0 && (
            <div>
              <div style={FEATURE_GROUP_LABEL}>开关</div>
              <div style={FEATURE_FLAG_GRID}>
                {flagEntries.map(([key, meta]) => (
                  <Checkbox key={key} checked={!!features.flags[key]} onChange={() => features.toggle(key)} label={meta.label} />
                ))}
              </div>
            </div>
          )}
          {numberEntries.length > 0 && (
            <div>
              <div style={FEATURE_GROUP_LABEL}>数值</div>
              <div style={FEATURE_FIELD_GRID}>
                {numberEntries.map(([key, meta]) => (
                  <Field key={key} label={meta.label}>
                    <Input
                      type="number"
                      min={0}
                      {...(meta.step !== undefined ? { step: meta.step } : {})}
                      aria-label={meta.label}
                      placeholder={meta.placeholder}
                      value={features.numbers[key] ?? ''}
                      onChange={(e) => features.setNumber(key, e.target.value)}
                      style={FULL}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
          {stringEntries.length > 0 && (
            <div>
              <div style={FEATURE_GROUP_LABEL}>文本</div>
              <div style={FEATURE_FIELD_GRID}>
                {stringEntries.map(([key, meta]) => (
                  <Field key={key} label={meta.label}>
                    <Input
                      placeholder={meta.placeholder}
                      value={features.strings[key] ?? ''}
                      onChange={(e) => features.setString(key, e.target.value)}
                      style={FULL}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
          {hasUnrecognised && (
            <div>
              <div style={FEATURE_GROUP_LABEL}>
                未识别字段 <Hint>老数据里形态对不上的键（如类型不符的脏值）。按原样保留，保存时合并回 features；确认无用可点右侧删除。</Hint>
              </div>
              <div style={FEATURE_FIELD_GRID}>
                {unrecognisedEntries.map(([key, value]) => (
                  <Field
                    key={key}
                    label={
                      <>
                        {key}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="删除这个键"
                          style={{ marginLeft: 'auto' }}
                          onClick={() => extraFeatures.remove(key)}
                        >
                          删除
                        </Button>
                      </>
                    }
                  >
                    <Input readOnly value={JSON.stringify(value)} style={FULL} />
                  </Field>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
