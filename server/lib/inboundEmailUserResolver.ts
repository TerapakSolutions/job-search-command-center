import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { contacts, inboundEmails, users } from '../db/schema.js';
import { emailAddressesIn } from './inboundEmailService.js';

export function resolveUserIdForInboundEmail(
  db: Db,
  email: typeof inboundEmails.$inferSelect,
): string | null {
  const to = emailAddressesIn(email.toEmail);
  const from = emailAddressesIn(email.fromEmail)[0] ?? '';

  const allUsers = db.select().from(users).all();
  for (const user of allUsers) {
    const userEmail = user.email.trim().toLowerCase();
    if (!userEmail) continue;
    if (from === userEmail || to.includes(userEmail)) {
      return user.id;
    }
  }

  if (!from) return null;

  const matchingContacts = db
    .select({ userId: contacts.userId })
    .from(contacts)
    .where(eq(contacts.email, email.fromEmail))
    .all();

  for (const contact of matchingContacts) {
    return contact.userId;
  }

  const allContacts = db.select().from(contacts).all();
  for (const contact of allContacts) {
    if (contact.email.trim().toLowerCase() === from) {
      return contact.userId;
    }
  }

  return null;
}
