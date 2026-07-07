# 修复右侧 Agent 面板技能按钮无法打开 SkillPanel 弹窗

## 问题

产品经理反馈：右侧 Agent 对话框中的「技能」按钮点击后没有反应，无法打开 SkillPanel 弹窗。该弹窗需要与首页 composer 共用同一个 `SkillPanel` 组件和逻辑。

## 检测结果

检查 `app/canvas/page.tsx` 中 `AgentChatPanel` 的实现：

- 技能按钮只有 `aria-controls="tc-agent-skill-panel"` 和 `data-tour-target="agent-skill-button"`。
- 没有 `onClick` 事件处理，也没有引入 `SkillPanel` 组件。
- `AgentChatPanel` 内部缺少 `skillPanelOpen` 状态以及向 composer 中插入 `@skillName ` 的回调。

因此点击技能按钮无任何响应。

## 修改内容

- 文件：`app/canvas/page.tsx`
- 引入共享组件：
  - `import SkillPanel from "@/components/SkillPanel";`
- 在 `AgentChatPanel` 中新增状态：
  - `const [skillPanelOpen, setSkillPanelOpen] = useState(false);`
- 新增 `insertSkillIntoComposer` 回调：
  - 聚焦 `composerRef` 对应的 `contentEditable` 编辑器。
  - 在光标位置插入 `@{skillName} ` 文本节点；如果无选区则在末尾追加。
  - 调用 `handleComposerInput()` 更新空状态。
  - 关闭弹窗 `setSkillPanelOpen(false)`。
- 技能按钮：
  - 添加 `onClick={() => setSkillPanelOpen(true)}`。
  - `aria-expanded` 从固定 `false` 改为动态 `skillPanelOpen`。
- 在 `AgentChatPanel` 返回的 JSX 末尾渲染：
  ```tsx
  <SkillPanel
    isOpen={skillPanelOpen}
    onClose={() => setSkillPanelOpen(false)}
    onUseSkill={insertSkillIntoComposer}
  />
  ```

## 验证

- `npm run build` 通过，无 TypeScript / 编译错误。
- 清除旧的 `next-server` 进程，重新启动生产服务。
- 运行 `node verify-agent-skill.mjs`：
  - 点击右侧 Agent 面板的「技能」按钮，成功打开共享 `SkillPanel` 弹窗。
  - 点击「Brand Design System」的「直接使用」按钮，弹窗关闭并在 composer 中插入 `@Brand Design System `。
- 更新截图：
  - `docs/agent-panel-skill-popup.png`
  - `docs/agent-panel-skill-inserted.png`

## 相关文件

- `app/canvas/page.tsx`
- `components/SkillPanel.tsx`
- `components/AgentComposer.tsx`
- `verify-agent-skill.mjs`
- `docs/agent-panel-skill-popup.png`
- `docs/agent-panel-skill-inserted.png`
