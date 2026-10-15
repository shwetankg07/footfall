import { useEffect, useState, useCallback } from "react";
import { api } from "../services/api";

// GET a path and keep the previous data while refetching, so charts don't flash empty.
export const useApi = (path) => {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    api
      .get(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState((prev) => ({ ...prev, error, loading: false })));
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
};
