import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  company: text('company').notNull(),
  roleTitle: text('role_title').notNull(),
  jobUrl: text('job_url').notNull().default(''),
  workLocationType: text('work_location_type').notNull().default('remote'),
  location: text('location').notNull().default(''),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  dateApplied: text('date_applied'),
  status: text('status').notNull().default('saved'),
  notes: text('notes').notNull().default(''),
  interviewDate: text('interview_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull().default(''),
  linkedIn: text('linked_in').notNull().default(''),
  lastContactDate: text('last_contact_date'),
  messageNotes: text('message_notes').notNull().default(''),
  nextAction: text('next_action').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const communications = sqliteTable('communications', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contacts.id, {
    onDelete: 'set null',
  }),
  channel: text('channel').notNull().default('email'),
  direction: text('direction').notNull().default('outbound'),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  occurredAt: text('occurred_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const followUpTasks = sqliteTable('follow_up_tasks', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contacts.id, {
    onDelete: 'set null',
  }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  dueDate: text('due_date').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const interviews = sqliteTable('interviews', {
  id: text('id').primaryKey(),
  applicationId: text('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  scheduledAt: text('scheduled_at').notNull(),
  type: text('type').notNull().default('video'),
  location: text('location').notNull().default(''),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').references(() => applications.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  type: text('type').notNull().default('other'),
  content: text('content').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
