/* ============================================
 * 输出像素表（`features.video_dimensions`）的矩阵编辑器
 *
 * **行 = 比例选项，列 = 尺寸选项，格子填宽x高**——形态照**同一个 tab 里**图片那张 seedream
 * 像素矩阵（`SizeMaterialTab` 的「出站尺寸映射」；用户口径：「参考图片模型的表格啊」）：
 * `<Table>` + `<thead>` 列头 + 每行一个比例 + 格子里一个控件。
 * 原先这里是一长条 `键（只读）→ 值` 的平铺列表，几十行 `resolution=480p|aspect_ratio=16:9`
 * 读不出「这是什么档位、什么比例」。
 *
 * ⚠️ **存储没变，还是扁平的**（矩阵只是视图，见 `dimensionGrid.ts` 的文件头）：
 * 跨进程的是 backend 解析出来的 `output_width` / `output_height` 两个标量。
 *
 * ⚠️ 派生不出候选时**不猜**一份档位清单顶上去，退回自由键值编辑（与 `SpecRows` 的
 * `derived=false` 分支同一条路）。
 * ============================================ */
import { Trash2 } from 'lucide-react';
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';
import { Alert, Badge, Button, Input, Table } from '../../ui';
import { buildDimensionGrid, setGridCell } from './dimensionGrid';
import { FULL } from './formLayout';
import type { SizeForm } from './model-form';
import { KeyValueEditor } from './SpecRows';

interface DimensionMatrixProps {
  /** 本行的尺寸档（列）；比例（行） */
  sizes: SizeForm[];
  ratios: string[];
  /** 表单里那份扁平表 */
  rows: KeyValueRow[];
  /** 候选集是否派生得出来；`false` = 退回自由键值编辑 */
  derived: boolean;
  onRows: (rows: KeyValueRow[]) => void;
}

export default function DimensionMatrix({ sizes, ratios, rows, derived, onRows }: DimensionMatrixProps) {
  const grid = buildDimensionGrid(sizes, ratios, rows);

  // 降级路径：本行还没配尺寸档 / 比例，键派生不出来。**锁住界面比让人填错更坏，
  // 但也不替它猜**一份档位清单（见 sizeCandidates.ts 的退化口径）。
  if (!derived || grid.columns.length === 0 || grid.rows.length === 0) {
    return (
      <>
        <Alert tone="warning">
          本行还没配尺寸档与比例，键派生不出来 —— 暂时按手工填键的方式编辑。配好尺寸与比例后，
          这里会显示成矩阵表格（行=比例、列=尺寸），键由本行派生、不再手敲。
        </Alert>
        <KeyValueEditor
          rows={rows}
          ariaPrefix="输出像素表"
          keyPlaceholder="resolution=480p|aspect_ratio=16:9"
          valuePlaceholder="864x496"
          makeRow={() => ({ key: '', value: '' })}
          onChange={onRows}
        />
      </>
    );
  }

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>比例</th>
            {grid.columns.map((column) => (
              <th key={column.id}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, rowIndex) => (
            <tr key={row.ratio}>
              <td>{row.ratio}</td>
              {row.cells.map((cell, columnIndex) => (
                <td key={grid.columns[columnIndex]?.id ?? columnIndex}>
                  <Input
                    size="sm"
                    aria-label={`${row.ratio} 行 ${grid.columns[columnIndex]?.label ?? ''} 列`}
                    placeholder="留空"
                    value={cell.value}
                    onChange={(e) => onRows(setGridCell(grid, rowIndex, columnIndex, e.target.value))}
                    style={FULL}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>

      {/* 库里有、本行档位里没有的键：**不静默丢掉**（静默删掉等于在一次「只填一格」的保存里
          顺手改了别的模型配置），也不能塞进矩阵——它不属于任何一行一列。 */}
      {grid.orphans.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {grid.orphans.map((row, index) => (
            <div key={`${row.key}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ fontSize: 'var(--admin-font-xs)' }}>{row.key}</code>
              {/* ⚠️ 不静默丢掉：静默删掉等于在一次「只改一格」的保存里顺手改了别的档位 */}
              <Badge tone="warning">模型配置里没有这一档</Badge>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--admin-font-xs)', }}>{row.value}</span>
              <Button
                size="sm"
                variant="ghost"
                title="删掉这一行"
                aria-label={`删掉输出像素表第 ${index + 1} 行孤儿`}
                icon={<Trash2 size={15} strokeWidth={2} />}
                // 按**行对象**删（`orphans` 里就是 `rows` 里的那几个引用），不是按键删——
                // 按 key 删会把同键的多行一起删掉
                onClick={() => onRows(rows.filter((item) => item !== row))}
              />
            </div>
          ))}
          <div style={{ fontSize: 'var(--admin-font-xs)', }}>
            标黄的行在<b>模型配置</b>里没有对应档位 —— 用户根本选不到它，含它的提交也查不到这张表里的像素。
            要么在模型配置里补上，要么在这里删掉。
          </div>
        </div>
      )}
    </>
  );
}
