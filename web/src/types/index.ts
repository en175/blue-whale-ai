/** 侧边栏菜单项定义 */
export interface MenuItem {
  key: string;
  label: string;
  icon: string;
  path: string;
}

/** 画布节点数据 */
export interface CanvasNodeData {
  label: string;
  type?: string;
  [key: string]: unknown;
}

/** 应用全局状态 */
export interface AppState {
  /** 当前激活的侧边栏菜单 */
  activeMenu: string;
  /** 侧边栏是否折叠 */
  sidebarCollapsed: boolean;
}
