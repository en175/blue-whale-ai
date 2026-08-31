/* ============================================
 * App 应用根组件：挂载全局路由 + 启动同步 /api/me 用户信息
 * ============================================ */
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import router from '@/router';
import AuthExpiredGate from '@/components/AuthExpiredGate';
import { fetchMe, toSessionUser } from '@/api/auth';
import { updateUser } from '@/utils/auth';

let meSyncStarted = false;

function App() {
  // 启动即经 HttpOnly 会话 cookie 拉 /api/me 恢复登录态（is_admin 控制系统设置入口）；
  // 未登录时后端返回 401，http 层清空本地会话，此处静默即可
  useEffect(() => {
    if (meSyncStarted) return;
    meSyncStarted = true;
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      <AuthExpiredGate />
      <Toaster position="top-center" theme="dark" duration={2600} />
    </>
  );
}

export default App;
