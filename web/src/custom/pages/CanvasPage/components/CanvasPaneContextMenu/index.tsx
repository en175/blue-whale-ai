import CanvasContextMenu from '../CanvasContextMenu';
import type { CanvasContextMenuItem } from '../CanvasContextMenu';

export type PaneNodeKind = 'text' | 'image' | 'video' | 'audio';

interface CanvasPaneContextMenuProps {
  paneMenu: { x: number; y: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  onClose: () => void;
  onUpload: () => void;
  onAddNode: (kind: PaneNodeKind) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export default function CanvasPaneContextMenu({
  paneMenu,
  canUndo,
  canRedo,
  onClose,
  onUpload,
  onAddNode,
  onUndo,
  onRedo,
}: CanvasPaneContextMenuProps) {
  if (!paneMenu) return null;
  const items: CanvasContextMenuItem[] = [
    { key: 'upload', label: '上传' },
    {
      key: 'addNode',
      label: '添加节点',
      children: [
        { key: 'add-text', label: '文本' },
        { key: 'add-image', label: '图片' },
        { key: 'add-video', label: '视频' },
        { key: 'add-audio', label: '音频' },
      ],
    },
    { key: 'undo', label: '撤销', disabled: !canUndo },
    { key: 'redo', label: '重做', disabled: !canRedo },
  ];
  return (
    <CanvasContextMenu
      x={paneMenu.x}
      y={paneMenu.y}
      items={items}
      onClose={onClose}
      onSelect={(key) => {
        if (key === 'upload') onUpload();
        else if (key === 'add-text') onAddNode('text');
        else if (key === 'add-image') onAddNode('image');
        else if (key === 'add-video') onAddNode('video');
        else if (key === 'add-audio') onAddNode('audio');
        else if (key === 'undo') onUndo();
        else if (key === 'redo') onRedo();
      }}
    />
  );
}
