import { useEffect, useState } from 'react';
import { request } from './api';

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined); setError(undefined); setLoading(true);
    if (!path) { setLoading(false); return; }
    request<T>(path, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setData(value); setLoading(false); }
    }).catch(value => {
      if (!controller.signal.aborted) { setError(value); setLoading(false); }
    });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, reload: () => setRevision(value => value + 1) };
}

export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  async function run(action: () => Promise<unknown>, success: string = '') {
    setBusy(true); setError(undefined); setNotice('');
    try { await action(); setNotice(success); return true; }
    catch (value) { setError(value); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, notice, run };
}
