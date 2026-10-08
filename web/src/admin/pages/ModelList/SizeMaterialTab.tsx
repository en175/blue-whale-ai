/* ============================================
 * 「尺寸与素材」tab：尺寸档位 / 比例 / 出站尺寸映射（渠道类型 + 三张映射表）/
 * 输出像素表 / 默认值 / 时长 / 格式 / 特性 features / 任务类型比例约束。
 *
 * 从 `ModelFormModal.tsx` 拆出来（那个文件已顶到 `max-lines` 上限）：内容按现有区块归位，
 * **没有新增字段**——原先那些 by-type 条件渲染原样保留（`visible.*`）。
 *
 * 图片的「出站尺寸映射」（渠道类型 + gpt 交叉格 / banana 一维表 / seedream 像素矩阵）是从
 * `AdvancedTab` **整块搬来**的（渲染逻辑逐字未改）：它与视频那张输出像素表是同一件事，
 * 而控制项与被它决定的表分在两个 tab 是最难用的一种切分。两张表各有一个小节
 * 标题与 Hint，说明谁在用、什么时候用。
 * ============================================ */
import { Plus, X } from 'lucide-react';
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';
import {
  GPT_PROVIDER_SIZES,
  TASK_TYPE_KEYS,
  channelOf,
  type ChannelId,
  type GptMatrix,
  type ModelType,
  type SizeForm,
} from './model-form';
import {
  FEATURE_BOOL_LABELS,
  FEATURE_NUMBER_LABELS,
  FEATURE_STRING_LABELS,
  featureApplies,
} from './feature-fields';
import { Badge, Button, Checkbox, Chip, Field, Input, Select, Table } from '../../ui';
import DimensionMatrix from './DimensionMatrix';
import { Hint } from '../../ui';
import { CHIP_LIST, CHECK_STACK, FULL, GRID2, GRID3, INLINE_ROW, LABEL, SECTION, SIZE_ROW, TASK_ROW } from './formLayout';

interface SizeMaterialTabProps {
  type: ModelType;
  /** 渠道：**只读**。它在「基础」tab 里配（那是身份级决策），这里只回显 ——
   *  下面那张映射表由它决定，不标明就不知道自己在填哪张表。
   *  ⚠️ 别把它做成第二个可编辑入口：同一个值两处可改，谁最后写谁生效。 */
  channel: ChannelId;
  /** gpt 交叉格（行=比例、列=尺寸、格子填官方 size）。 */
  gpt: { matrix: GptMatrix; setCell: (sizeId: string, ratio: string, value: string) => void };
  /** seedream 像素矩阵（行=比例、列=尺寸、格子填出站像素如 `2048x2048`）。 */
  seedream: { matrix: GptMatrix; setCell: (sizeId: string, ratio: string, value: string) => void };
  /** banana 一维映射（尺寸→quality、比例→size）。 */
  banana: {
    quality: Record<string, string>;
    setQuality: (value: Record<string, string>) => void;
    size: Record<string, string>;
    setSize: (value: Record<string, string>) => void;
  };
  /** 哪些区块对当前类型可见（原 `showSizeRatio` / `showDuration` / …） */
  visible: {
    sizeRatio: boolean;
    duration: boolean;
    defaultDuration: boolean;
    format: boolean;
    /** 该类型有没有专属的结构化特性键 */
    structuredFeature: boolean;
  };
  sizes: {
    rows: SizeForm[];
    add: () => void;
    update: (index: number, patch: Partial<SizeForm>) => void;
    remove: (index: number) => void;
  };
  ratios: { rows: string[]; remove: (ratio: string) => void; draft: string; setDraft: (value: string) => void; add: () => void };
  /** 输出像素表 `features.video_dimensions`；`candidates` 由本行的「档位 × 比例」派生 */
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
  taskTypes: {
    ratios: Record<string, string[]>;
    draft: Record<string, string>;
    setDraft: (value: Record<string, string>) => void;
    add: (taskType: string) => void;
    remove: (taskType: string, ratio: string) => void;
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
  taskTypes,
}: SizeMaterialTabProps) {
  // 三张表的开关仍按**解析器**判断（渲染逻辑逐字未改），解析器来自渠道：
  // seedream / banana 渠道各只有一种协议，两个 gpt 渠道（内联 / 官方）共用同一张交叉格。
  // 非图片渠道的 parser 为 null → 回落 seedream（那些行不渲染这一节）。
  const parser = channelOf(channel).parser ?? 'seedream';
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

          <h3 style={SECTION}>比例选项</h3>
          <div style={CHIP_LIST}>
            {ratios.rows.map((ratio) => (
              <Chip key={ratio} onClick={() => ratios.remove(ratio)}>
                {ratio} ×
              </Chip>
            ))}
          </div>
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

      {/* ── 出站尺寸映射（图片）：渠道类型 + 三张映射表 ──────────────────────────────
          从「高级」tab 整块搬来（渲染逻辑逐字未改）。<b>控制项与它控制的表必须在一起</b>：
          渠道类型决定用哪张表，分在两个 tab 里切一下渠道要跑去另一个 tab 才看得见表换没换。
          与下面视频那张输出像素表并排——两张表说的都是「这张能力行的出站尺寸从哪来」，
          各自一个小节标题与 Hint 说清谁在用、什么时候用。 */}
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
            与视频行的「输出像素表 video_dimensions」不是一张：那张只在预扣估 token 时用，
            这张决定真正发给上游的尺寸 / 映射。
          </Hint></h3>
          <div style={LABEL}>渠道</div>
          <div>
            <b>{channelOf(channel).label}</b>
            <span>（在「基础」里改）</span>
          </div>

          {/* IKHU8P：矩阵转置成「行=比例、列=尺寸」。原方向是行=尺寸、列=比例，而 gpt 的比例最多 13 个，
              14 列把单元格压到约 40px——下拉框左右 padding 加原生箭头就把正文吃光，值看着是空的。 */}
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
                    <tr key={ratio}>
                      <td>{ratio}</td>
                      {sizes.rows.map((size) => (
                        <td key={size.id || size.label}>
                          <Select
                            size="sm"
                            aria-label={`${ratio} 行 ${size.label || size.id} 列`}
                            options={[
                              { value: '', label: '留空' },
                              ...GPT_PROVIDER_SIZES.map((item) => ({ value: item, label: item })),
                            ]}
                            value={gpt.matrix[size.id]?.[ratio] ?? ''}
                            onChange={(next) => gpt.setCell(size.id, ratio, next)}
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
              {/* 两张一维表各有自己的「列头」——说明挂在第一张表的列头上，才有锚点 */}
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
                    <div style={INLINE_ROW} key={ratio}>
                      <Badge tone="neutral">{ratio}</Badge>
                      <Input
                        placeholder="调用值，如 1x1"
                        value={banana.size[ratio] ?? ''}
                        onChange={(e) => banana.setSize({ ...banana.size, [ratio]: e.target.value })}
                        style={FULL}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* IKHU8P：与 gpt 同因同改——转置成「行=比例、列=尺寸」，免得比例一多就把格子压到看不见。 */}
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
                    <tr key={ratio}>
                      <td>{ratio}</td>
                      {sizes.rows.map((size) => (
                        <td key={size.id || size.label}>
                          <Input
                            size="sm"
                            aria-label={`${ratio} 行 ${size.label || size.id} 列`}
                            placeholder="留空"
                            value={seedream.matrix[size.id]?.[ratio] ?? ''}
                            onChange={(e) => seedream.setCell(size.id, ratio, e.target.value)}
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

      {/* ── 输出像素表（`features.video_dimensions`）────────────────────────────────
          存储形态是扁平的 `"resolution=480p|aspect_ratio=16:9" → "864x496"`，<b>不改</b>：这张表
          不跨进程——跨进程的是 backend 解析出来的 `output_width` / `output_height` 两个标量
          （`resolveOutputPixels` 查完冻进快照）。矩阵只是<b>视图</b>（行=比例、列=尺寸），
          扁平是序列化形态，所以下面那张表一个字都不落到存储里。
          只在<b>预扣估 token</b> 时用（提交那一刻没有真实 token）。键从本行的「档位 × 比例」派生
          （别手敲——后端写闸门要求键必须形如 `resolution=X|aspect_ratio=Y`、值必须形如 `WxH`，
          形态不对直接拒存），值由运营按官方对照表填。 */}
      {type === 'video' && (
        <>
          <h3 style={SECTION}>输出像素表 video_dimensions（视频 · 只在预扣估 token 时用） <Hint>
            这张表与图片行的「出站尺寸映射」不是一张，它是<b>视频</b>行专用的：只在
            <b>按 token 计费的预扣</b>里用——提交那一刻没有真实 token，服务端按这里配的宽高估一个
            上限来冻结，结算仍按上游返回的真值。
            行=比例选项，列=尺寸选项，格子填这个组合的输出像素（如 480P × 16:9 → 864x496），
            官方对照表上抄。<b>留空 = 这条组合不能用</b>：含该档的提交会因「算不出上限」被拒，
            不是「随便估一个」。
          </Hint></h3>
          <DimensionMatrix
            sizes={sizes.rows}
            ratios={ratios.rows}
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

      {/* IKHBDO：结构化 features 对所有类型开放。此前 audio / text 被排除在结构化块之外，
          而高级 JSON 兜底又只对 image / video 渲染——两种条件互相抵消，音频行连 JSON 出口都没有。 */}
      <h3 style={SECTION}>
        特性 features（结构化）
        {!visible.structuredFeature && (
          <Hint>该类型没有专属的结构化特性键，可直接去「高级」用 JSON 配置。</Hint>
        )}
      </h3>
      <div style={CHECK_STACK}>
        {Object.entries(FEATURE_BOOL_LABELS)
          .filter(([, meta]) => featureApplies(meta, type))
          .map(([key, meta]) => (
            <Checkbox key={key} checked={!!features.flags[key]} onChange={() => features.toggle(key)} label={meta.label} />
          ))}
      </div>
      <div style={GRID2}>
        {Object.entries(FEATURE_NUMBER_LABELS)
          .filter(([, meta]) => featureApplies(meta, type))
          .map(([key, meta]) => (
            <Field key={key} label={<>{meta.label} <span>（留空不写入）</span></>}>
              <Input
                type="number"
                min={0}
                placeholder={meta.placeholder}
                value={features.numbers[key] ?? ''}
                onChange={(e) => features.setNumber(key, e.target.value)}
                style={FULL}
              />
            </Field>
          ))}
      </div>
      <div style={GRID2}>
        {Object.entries(FEATURE_STRING_LABELS)
          .filter(([, meta]) => featureApplies(meta, type))
          .map(([key, meta]) => (
            <Field key={key} label={<>{meta.label} <span>（留空不写入）</span></>}>
              <Input
                placeholder={meta.placeholder}
                value={features.strings[key] ?? ''}
                onChange={(e) => features.setString(key, e.target.value)}
                style={FULL}
              />
            </Field>
          ))}
      </div>

      {/* ADR-0086：按任务类型的比例约束——原先只能在整个 features 的 JSON 里手写。 */}
      {type === 'video' && (
        <>
          <h3 style={SECTION}>任务类型比例约束 task_types <Hint>留空 = 该任务类型沿用基础「比例选项」。只编辑 allowed_ratios，行内其它子键原样保留。</Hint></h3>
          {TASK_TYPE_KEYS.map((taskType) => (
            <div style={TASK_ROW} key={taskType}>
              <Badge tone="neutral">{taskType}</Badge>
              <div style={CHIP_LIST}>
                {(taskTypes.ratios[taskType] ?? []).map((ratio) => (
                  <Chip key={ratio} onClick={() => taskTypes.remove(taskType, ratio)}>
                    {ratio} ×
                  </Chip>
                ))}
              </div>
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
                style={FULL}
              />
              <Button onClick={() => taskTypes.add(taskType)}>添加</Button>
            </div>
          ))}
        </>
      )}
    </>
  );
}
