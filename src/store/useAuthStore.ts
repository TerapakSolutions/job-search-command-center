import { create } from 'zustand';
import type { User } from '../types/user';
import { fetchCurrentUser, logout as logoutRequest } from '../api/authClient';

interface AuthState {
  user: User | null;
  loading: boolean;
  checked: boolean;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  checked: false,

  checkAuth: async () => {
    set({ loading: true });
    try {
      const user = await fetchCurrentUser();
      set({ user, loading: false, checked: true });
    } catch {
      set({ user: null, loading: false, checked: true });
    }
  },

  logout: async () => {
    await logoutRequest();
    set({ user: null, checked: true });
  },
}));
