import { Trash2 } from 'lucide-react';
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';
import { Alert, Badge, Button, Input, Table } from '../../ui';
import { buildDimensionGrid, setGridCell } from './dimensionGrid';
import { FULL } from './formLayout';
import type { SizeForm } from './model-form';
import { KeyValueEditor } from './SpecRows';

interface DimensionMatrixProps {
  sizes: SizeForm[];
  ratios: string[];
  rows: KeyValueRow[];
  derived: boolean;
  onRows: (rows: KeyValueRow[]) => void;
}

export default function DimensionMatrix({ sizes, ratios, rows, derived, onRows }: DimensionMatrixProps) {
  const grid = buildDimensionGrid(sizes, ratios, rows);

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

      {}
      {grid.orphans.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {grid.orphans.map((row, index) => (
            <div key={`${row.key}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ fontSize: 'var(--admin-font-xs)' }}>{row.key}</code>
              {}
              <Badge tone="warning">模型配置里没有这一档</Badge>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--admin-font-xs)', }}>{row.value}</span>
              <Button
                size="sm"
                variant="ghost"
                title="删掉这一行"
                aria-label={`删掉输出像素表第 ${index + 1} 行孤儿`}
                icon={<Trash2 size={15} strokeWidth={2} />}
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
