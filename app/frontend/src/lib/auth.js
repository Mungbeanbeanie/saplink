import { useCallback, useEffect, useState } from 'react';

const KEY = 'saplink.signedIn';

export function useAuth() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    try { setSignedIn(localStorage.getItem(KEY) === '1'); } catch (e) {}
  }, []);
  const signIn = useCallback(() => {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    setSignedIn(true);
  }, []);
  const signOut = useCallback(() => {
    try { localStorage.removeItem(KEY); } catch (e) {}
    setSignedIn(false);
  }, []);
  return { signedIn, signIn, signOut, user: { name: 'Rowan Ashfield', email: 'r.ashfield@wealdtrust.org', role: 'Conservation lead' } };
}
