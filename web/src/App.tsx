import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import router from '@/custom/router';
import LoginDialog from '@/custom/components/LoginDialog';
import ForeignDraftReset from '@/shared/session/ForeignDraftReset';
import { fetchMe, toSessionUser } from '@/custom/api/auth';
import { updateUser } from '@/shared/utils/auth';
import { installSessionSyncListener } from '@/shared/utils/sessionSync';

let meSyncStarted = false;

function App() {
  useEffect(() => {
    if (meSyncStarted) return;
    meSyncStarted = true;
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, []);

  useEffect(() => installSessionSyncListener(), []);

  return (
    <>
      <RouterProvider router={router} />
      <ForeignDraftReset />
      <LoginDialog />
      <Toaster position="top-center" theme="dark" duration={2600} />
    </>
  );
}

export default App;
