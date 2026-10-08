export interface MenuItem {
  key: string;
  label: string;
  icon: string;
  path: string;
}

export interface CanvasNodeData {
  label: string;
  type?: string;
  [key: string]: unknown;
}

export interface AppState {
  activeMenu: string;
  sidebarCollapsed: boolean;
}
