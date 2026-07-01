import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { contacts, inboundEmails, users } from '../db/schema.js';

export function resolveUserIdForInboundEmail(
  db: Db,
  email: typeof inboundEmails.$inferSelect,
): string | null {
  const to = email.toEmail.trim().toLowerCase();
  const from = email.fromEmail.trim().toLowerCase();

  const allUsers = db.select().from(users).all();
  for (const user of allUsers) {
    const userEmail = user.email.trim().toLowerCase();
    if (!userEmail) continue;
    if (to.includes(userEmail) || from === userEmail) {
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
