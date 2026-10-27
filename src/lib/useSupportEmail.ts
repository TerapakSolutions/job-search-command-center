import { useEffect, useState } from 'react';
import { fetchPublicConfig } from '../api/authClient';

/** The address people can write to about the app, or null when none is set. */
export function useSupportEmail(): string | null {
  const [supportEmail, setSupportEmail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchPublicConfig().then((config) => {
      if (active) setSupportEmail(config.supportEmail);
    });
    return () => {
      active = false;
    };
  }, []);
  return supportEmail;
}
