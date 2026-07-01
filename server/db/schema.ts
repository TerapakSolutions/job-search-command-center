import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleId: text('google_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').references(() => applications.id, {
    onDelete: 'set null',
  }),
  name: text('name').notNull(),
  type: text('type').notNull().default('other'),
  content: text('content').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const inboundEmails = sqliteTable('inbound_emails', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  subject: text('subject').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  toEmail: text('to_email').notNull().default(''),
  receivedAt: text('received_at').notNull(),
  payload: text('payload').notNull(),
  processed: integer('processed', { mode: 'boolean' }).notNull().default(false),
  classification: text('classification'),
  classificationConfidence: integer('classification_confidence'),
  companyName: text('company_name'),
  positionTitle: text('position_title'),
  recruiterName: text('recruiter_name'),
  requiresResponse: integer('requires_response', { mode: 'boolean' }),
  suggestedAction: text('suggested_action'),
  actionDueAt: text('action_due_at'),
  interviewDetected: integer('interview_detected', { mode: 'boolean' }),
  interviewDatetime: text('interview_datetime'),
  aiSummary: text('ai_summary'),
  processedAt: text('processed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const emailAutomationAuditLog = sqliteTable('email_automation_audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  inboundEmailId: text('inbound_email_id')
    .notNull()
    .references(() => inboundEmails.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(),
  confidence: integer('confidence'),
  status: text('status').notNull().default('completed'),
  detailsJson: text('details_json').notNull().default('{}'),
  resultingChangesJson: text('resulting_changes_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
});

export const emailAutomationPendingApprovals = sqliteTable(
  'email_automation_pending_approvals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inboundEmailId: text('inbound_email_id')
      .notNull()
      .references(() => inboundEmails.id, { onDelete: 'cascade' }),
    approvalType: text('approval_type').notNull(),
    applicationId: text('application_id').references(() => applications.id, {
      onDelete: 'cascade',
    }),
    proposedStatus: text('proposed_status').notNull(),
    currentStatus: text('current_status'),
    confidence: integer('confidence').notNull(),
    reason: text('reason').notNull().default(''),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
);

export const dailyBriefings = sqliteTable(
  'daily_briefings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    briefingDate: text('briefing_date').notNull(),
    aiSummary: text('ai_summary').notNull().default(''),
    dataJson: text('data_json').notNull().default('{}'),
    status: text('status').notNull().default('completed'),
    emailSentAt: text('email_sent_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('daily_briefings_user_date_unique').on(
      table.userId,
      table.briefingDate,
    ),
  ],
);

export const jobSearchGoals = sqliteTable(
  'job_search_goals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dailyGoal: integer('daily_goal').notNull().default(5),
    weeklyGoal: integer('weekly_goal').notNull().default(25),
    monthlyGoal: integer('monthly_goal').notNull().default(100),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('job_search_goals_user_unique').on(table.userId)],
);

export const applicationOutcomeMetrics = sqliteTable(
  'application_outcome_metrics',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    applicationId: text('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    firstRecruiterResponseAt: text('first_recruiter_response_at'),
    firstInterviewAt: text('first_interview_at'),
    offerReceivedAt: text('offer_received_at'),
    daysToFirstResponse: integer('days_to_first_response'),
    daysApplicationToInterview: integer('days_application_to_interview'),
    daysInterviewToOffer: integer('days_interview_to_offer'),
    hadRecruiterResponse: integer('had_recruiter_response', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    hadInterview: integer('had_interview', { mode: 'boolean' })
      .notNull()
      .default(false),
    receivedOffer: integer('received_offer', { mode: 'boolean' })
      .notNull()
      .default(false),
    lastComputedAt: text('last_computed_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('application_outcome_metrics_app_unique').on(
      table.applicationId,
    ),
  ],
);
