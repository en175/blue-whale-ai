/* ============================================
 * App 应用根组件：挂载全局路由 + 启动同步 /api/me 用户信息
 * ============================================ */
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import router from '@/router';
import { fetchMe, toSessionUser } from '@/api/auth';
import { getAccessToken, updateUser } from '@/utils/auth';

let meSyncStarted = false;

function App() {
  // 启动时已有登录态则拉 /api/me 刷新最新用户信息（is_admin 控制系统设置入口）
  useEffect(() => {
    if (meSyncStarted || !getAccessToken()) return;
    meSyncStarted = true;
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, []);

  return <RouterProvider router={router} />;
}

export default App;
