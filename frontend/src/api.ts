import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'schedinabar_token';
const USER_KEY = 'schedinabar_user';

async function _get(k: string) {
  if (Platform.OS === 'web') return AsyncStorage.getItem(k);
  return SecureStore.getItemAsync(k);
}
async function _set(k: string, v: string | null) {
  if (Platform.OS === 'web') {
    if (v) await AsyncStorage.setItem(k, v);
    else await AsyncStorage.removeItem(k);
    return;
  }
  if (v) await SecureStore.setItemAsync(k, v);
  else await SecureStore.deleteItemAsync(k);
}

export type User = {
  id: string;
  role: 'admin' | 'player';
  username: string | null;
  email: string | null;
  blocked: boolean;
  must_change_password: boolean;
  created_at: string;
};

export const session = {
  async load(): Promise<{ token: string | null; user: User | null }> {
    const token = await _get(TOKEN_KEY);
    const raw = await _get(USER_KEY);
    return { token, user: raw ? JSON.parse(raw) : null };
  },
  async save(token: string, user: User) {
    await _set(TOKEN_KEY, token);
    await _set(USER_KEY, JSON.stringify(user));
  },
  async clear() {
    await _set(TOKEN_KEY, null);
    await _set(USER_KEY, null);
  },
};

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

function _extractErrorMessage(status: number, data: any): string {
  let msg: string = `Errore ${status}`;
  if (typeof data === 'object' && data?.detail) {
    if (typeof data.detail === 'string') {
      msg = data.detail;
    } else if (Array.isArray(data.detail)) {
      const first = data.detail[0];
      if (first?.msg) {
        msg = String(first.msg).replace(/^Value error,\s*/i, '');
      }
    }
  }
  return msg;
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: any; auth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await _get(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error(_extractErrorMessage(res.status, data));
  }
  return data as T;
}

/**
 * Upload a file (multipart/form-data) to a protected endpoint.
 * `path` must start with a leading slash (e.g. `/admin/voti/upload-pdf`).
 * Extra `params` are appended as URL query string (useful for `dry_run`, ...).
 */
export async function apiUpload<T = any>(
  path: string,
  file: { uri?: string; name: string; type: string; blob?: Blob },
  params: Record<string, string | number | boolean> = {}
): Promise<T> {
  const token = await _get(TOKEN_KEY);
  const form = new FormData();
  // On web we always work with a Blob (from <input type="file">).
  // On native we would need `{ uri, name, type }` as any.
  if (file.blob) {
    form.append('file', file.blob, file.name);
  } else {
    form.append('file', ({ uri: file.uri, name: file.name, type: file.type } as any));
  }
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = `${BASE}/api${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form as any,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new Error(_extractErrorMessage(res.status, data));
  }
  return data as T;
}
