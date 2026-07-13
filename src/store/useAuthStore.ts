import { create } from 'zustand';
import type { User } from '../types/user';
import { fetchCurrentUser, logout as logoutRequest } from '../api/authClient';

interface AuthState {
  user: User | null;
  loading: boolean;
  checked: boolean;
  /** True when the session died mid-session rather than never existing. */
  sessionExpired: boolean;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
  /** Called when the API reports 401: drop the stale user and force re-auth. */
  handleSessionExpired: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  checked: false,
  sessionExpired: false,

  checkAuth: async () => {
    set({ loading: true });
    try {
      const user = await fetchCurrentUser();
      set({
        user,
        loading: false,
        checked: true,
        sessionExpired: user ? false : get().sessionExpired,
      });
    } catch {
      set({ user: null, loading: false, checked: true });
    }
  },

  logout: async () => {
    await logoutRequest();
    set({ user: null, checked: true, sessionExpired: false });
  },

  handleSessionExpired: () => {
    // Already signed out — nothing to tear down.
    if (!get().user) return;
    set({ user: null, checked: true, loading: false, sessionExpired: true });
  },
}));
