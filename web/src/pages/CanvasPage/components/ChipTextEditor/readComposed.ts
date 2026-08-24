/**
 * 把 Lexical 的节点树读成片段序列（IKAFSX）。
 *
 * 单独成文件，是因为 IKAFSX 的验收里有一条「解引用后文本与旧行为**逐字一致**」的单测，
 * 而它原来长在 `index.tsx` 里——那个文件带着 React、`@lexical/react` 和 CSS Module，
 * 为了测一个纯粹的树遍历去把整个编辑器组件拉进测试进程并不划算。这里只依赖 `lexical`
 * 与 `ChipNode`，测试就能用一个 headless editor 直接喂节点树。
 */
import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $isChipNode } from './ChipNode';
import { BLOCK_SEPARATOR, EMPTY_COMPOSED, type ComposedSegment, type ComposedValue } from './composed';

/**
 * 读当前 root 下的全部内容。**必须在 `editor.update()` / `editorState.read()` 里调用**
 * （`$getRoot()` 依赖 Lexical 的活动编辑器上下文）。
 *
 * 相邻文本节点合并，免得计数与解引用被节点边界干扰。
 */
export function readComposed(): ComposedValue {
  const segments: ComposedSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.value += value;
    else segments.push({ kind: 'text', value });
  };
  const walk = (node: LexicalNode) => {
    if ($isChipNode(node)) {
      segments.push({ kind: 'ref', ref: node.toRef() });
      return;
    }
    if ($isElementNode(node)) {
      const children = node.getChildren();
      children.forEach((child, index) => {
        walk(child);
        // 块级子节点之间补回分隔符，规则**逐字照抄 Lexical 自己的 `ElementNode.getTextContent()`**：
        // 最后一个不加、行内元素不加。改成自己发明一条（比如只补一个 \n）就会让同一份内容在
        // 「编辑器显示」与「送给模型」之间产生偏差——IKAFSX 要的是行为等价。
        if (index !== children.length - 1 && $isElementNode(child) && !child.isInline()) {
          pushText(BLOCK_SEPARATOR);
        }
      });
      return;
    }
    pushText(node.getTextContent());
  };
  // 从 root 本身走起：root 也是 ElementNode，段落之间的分隔因此和嵌套层级走同一条规则，
  // 不需要在外面再补一遍（补了就会和上面那条重复）。
  walk($getRoot());
  return segments.length > 0 ? { segments } : EMPTY_COMPOSED;
}
