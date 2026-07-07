# 项目上下文 005

## 时间
2026-06-30

## 本次任务
为 `AgentComposer` 底部工具栏的「Seedance 2.0」模型选择按钮添加下拉菜单。

## 变更内容

### 1. 新增模型数据
- `MODELS` 数组包含：
  - Seedance 2.0
  - Seedance 2.0 Mini
  - Seedance 2.0 Fast

### 2. 新增状态
- `modelOpen`：控制下拉菜单显隐
- `selectedModel`：当前选中的模型
- `modelContainerRef`：用于点击外部关闭菜单

### 3. UI 更新
- 点击模型按钮时展开下拉菜单
- 下拉菜单位于按钮上方（`bottom-[calc(100%+6px)]`）
- 背景色 `bg-[rgb(35,35,35)]`、边框、圆角、阴影、滚动条样式与参考一致
- 选中项高亮 `bg-white/[0.04] text-white`
- 未选中项 `text-white/80`，hover 时 `bg-white/[0.08]`
- Chevron 图标在菜单打开时旋转 180°

### 4. 验证
- `npm run build` 成功
- Playwright 截图显示下拉菜单正常展开，样式对齐参考
- 预览截图：`docs/preview.png`

## Git 提交
待提交
