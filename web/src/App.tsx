import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import router from '@/custom/router';
import AuthExpiredGate from '@/custom/components/AuthExpiredGate';
import { fetchMe, toSessionUser } from '@/custom/api/auth';
import { updateUser } from '@/shared/utils/auth';

let meSyncStarted = false;

function App() {
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
