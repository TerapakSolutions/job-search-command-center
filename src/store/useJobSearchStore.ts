import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  applicationsApi,
  contactsApi,
  clearAllRemote,
  loadAllData,
} from '../api/jobSearchClient';
import { getPersistenceMode, isDemoMode } from '../api/persistence';
import { createId } from '../lib/id';
import { computeReminders } from '../lib/reminders';
import type { Application, ApplicationInput } from '../types/application';
import type { Contact, ContactInput } from '../types/contact';
import type { Reminder } from '../types/reminder';

const STORAGE_KEY = 'job-search-command-center';

interface JobSearchState {
  applications: Application[];
  contacts: Contact[];
  initialized: boolean;
  loading: boolean;
  error: string | null;
  persistenceMode: 'api' | 'demo';
  initialize: () => Promise<void>;
  refreshData: () => Promise<void>;
  addApplication: (input: ApplicationInput) => Application;
  updateApplication: (id: string, input: Partial<ApplicationInput>) => void;
  deleteApplication: (id: string) => void;
  moveApplication: (id: string, status: Application['status']) => void;
  addContact: (input: ContactInput) => Contact;
  updateContact: (id: string, input: Partial<ContactInput>) => void;
  deleteContact: (id: string) => void;
  getReminders: () => Reminder[];
  getApplicationById: (id: string) => Application | undefined;
  exportData: () => string;
  importData: (json: string) => void;
  clearAll: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

const storeCreator = (
  set: (
    partial:
      | Partial<JobSearchState>
      | ((state: JobSearchState) => Partial<JobSearchState>),
  ) => void,
  get: () => JobSearchState,
): JobSearchState => ({
  applications: [],
  contacts: [],
  initialized: false,
  loading: false,
  error: null,
  persistenceMode: getPersistenceMode(),

  initialize: async () => {
    if (get().initialized) return;
    if (isDemoMode()) {
      set({ initialized: true, persistenceMode: 'demo' });
      return;
    }
    set({ loading: true, error: null });
    try {
      const data = await loadAllData();
      set({
        applications: data.applications,
        contacts: data.contacts,
        initialized: true,
        loading: false,
        persistenceMode: 'api',
      });
    } catch {
      set({
        loading: false,
        initialized: true,
        error: 'Could not reach the API. Start the server or switch to demo mode.',
        persistenceMode: 'api',
      });
    }
  },

  refreshData: async () => {
    if (isDemoMode()) return;
    try {
      const data = await loadAllData();
      set({
        applications: data.applications,
        contacts: data.contacts,
        error: null,
      });
    } catch {
      set({ error: 'Could not refresh data from the API.' });
    }
  },

  addApplication: (input) => {
    const timestamp = nowIso();
    const optimistic: Application = {
      id: createId(),
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    set((state) => ({
      applications: [...state.applications, optimistic],
    }));
    if (!isDemoMode()) {
      applicationsApi
        .create(input)
        .then((saved) => {
          set((state) => ({
            applications: state.applications.map((app) =>
              app.id === optimistic.id ? saved : app,
            ),
          }));
        })
        .catch(() => {
          set((state) => ({
            applications: state.applications.filter(
              (app) => app.id !== optimistic.id,
            ),
            error: 'Failed to save application.',
          }));
        });
    }
    return optimistic;
  },

  updateApplication: (id, input) => {
    const previous = get().applications.find((app) => app.id === id);
    set((state) => ({
      applications: state.applications.map((app) =>
        app.id === id ? { ...app, ...input, updatedAt: nowIso() } : app,
      ),
    }));
    if (!isDemoMode()) {
      applicationsApi.update(id, input).catch(() => {
        if (previous) {
          set((state) => ({
            applications: state.applications.map((app) =>
              app.id === id ? previous : app,
            ),
            error: 'Failed to update application.',
          }));
        }
      });
    }
  },

  deleteApplication: (id) => {
    const previousApps = get().applications;
    const previousContacts = get().contacts;
    set((state) => ({
      applications: state.applications.filter((app) => app.id !== id),
      contacts: state.contacts.filter((c) => c.applicationId !== id),
    }));
    if (!isDemoMode()) {
      applicationsApi.remove(id).catch(() => {
        set({
          applications: previousApps,
          contacts: previousContacts,
          error: 'Failed to delete application.',
        });
      });
    }
  },

  moveApplication: (id, status) => {
    get().updateApplication(id, { status });
  },

  addContact: (input) => {
    const timestamp = nowIso();
    const optimistic: Contact = {
      id: createId(),
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    set((state) => ({
      contacts: [...state.contacts, optimistic],
    }));
    if (!isDemoMode()) {
      contactsApi
        .create(input)
        .then((saved) => {
          set((state) => ({
            contacts: state.contacts.map((c) =>
              c.id === optimistic.id ? saved : c,
            ),
          }));
        })
        .catch(() => {
          set((state) => ({
            contacts: state.contacts.filter((c) => c.id !== optimistic.id),
            error: 'Failed to save contact.',
          }));
        });
    }
    return optimistic;
  },

  updateContact: (id, input) => {
    const previous = get().contacts.find((c) => c.id === id);
    set((state) => ({
      contacts: state.contacts.map((contact) =>
        contact.id === id
          ? { ...contact, ...input, updatedAt: nowIso() }
          : contact,
      ),
    }));
    if (!isDemoMode()) {
      contactsApi.update(id, input).catch(() => {
        if (previous) {
          set((state) => ({
            contacts: state.contacts.map((c) => (c.id === id ? previous : c)),
            error: 'Failed to update contact.',
          }));
        }
      });
    }
  },

  deleteContact: (id) => {
    const previous = get().contacts;
    set((state) => ({
      contacts: state.contacts.filter((c) => c.id !== id),
    }));
    if (!isDemoMode()) {
      contactsApi.remove(id).catch(() => {
        set({ contacts: previous, error: 'Failed to delete contact.' });
      });
    }
  },

  getReminders: () => computeReminders(get().applications, get().contacts),

  getApplicationById: (id) => get().applications.find((app) => app.id === id),

  exportData: () =>
    JSON.stringify(
      {
        applications: get().applications,
        contacts: get().contacts,
        exportedAt: nowIso(),
      },
      null,
      2,
    ),

  importData: (json) => {
    const parsed = JSON.parse(json) as {
      applications?: Application[];
      contacts?: Contact[];
    };
    set({
      applications: parsed.applications ?? [],
      contacts: parsed.contacts ?? [],
    });
    if (!isDemoMode()) {
      clearAllRemote()
        .then(async () => {
          for (const app of parsed.applications ?? []) {
            const input: ApplicationInput = {
              company: app.company,
              roleTitle: app.roleTitle,
              jobUrl: app.jobUrl,
              workLocationType: app.workLocationType,
              location: app.location,
              salaryMin: app.salaryMin,
              salaryMax: app.salaryMax,
              dateApplied: app.dateApplied,
              status: app.status,
              notes: app.notes,
              interviewDate: app.interviewDate,
            };
            await applicationsApi.create(input);
          }
          for (const contact of parsed.contacts ?? []) {
            const input: ContactInput = {
              applicationId: contact.applicationId,
              name: contact.name,
              email: contact.email,
              linkedIn: contact.linkedIn,
              company: contact.company ?? '',
              source: contact.source ?? 'manual',
              lastContactDate: contact.lastContactDate,
              messageNotes: contact.messageNotes,
              nextAction: contact.nextAction,
            };
            await contactsApi.create(input);
          }
          return loadAllData();
        })
        .then((data) => {
          if (data) set({ applications: data.applications, contacts: data.contacts });
        })
        .catch(() => {
          set({ error: 'Import saved locally but API sync failed.' });
        });
    }
  },

  clearAll: () => {
    set({ applications: [], contacts: [] });
    if (!isDemoMode()) {
      clearAllRemote().catch(() => {
        set({ error: 'Failed to clear remote data.' });
      });
    }
  },
});

export const useJobSearchStore = isDemoMode()
  ? create<JobSearchState>()(persist(storeCreator, { name: STORAGE_KEY }))
  : create<JobSearchState>()(storeCreator);
