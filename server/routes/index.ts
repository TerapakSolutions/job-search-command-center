import type { Db } from '../db/index.js';
import {
  applications,
  contacts,
  communications,
  followUpTasks,
  interviews,
  documents,
} from '../db/schema.js';
import { createCrudRouter } from '../lib/crudRouter.js';

export function applicationsRouter(db: Db) {
  return createCrudRouter({
    db,
    table: applications,
    idCol: applications.id,
    buildCreate: (body, id, timestamp) => ({
      id,
      company: String(body.company ?? ''),
      roleTitle: String(body.roleTitle ?? ''),
      jobUrl: String(body.jobUrl ?? ''),
      workLocationType: String(body.workLocationType ?? 'remote'),
      location: String(body.location ?? ''),
      salaryMin: body.salaryMin != null ? Number(body.salaryMin) : null,
      salaryMax: body.salaryMax != null ? Number(body.salaryMax) : null,
      dateApplied: body.dateApplied ? String(body.dateApplied) : null,
      status: String(body.status ?? 'saved'),
      notes: String(body.notes ?? ''),
      interviewDate: body.interviewDate ? String(body.interviewDate) : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    buildUpdate: (body, timestamp) => ({
      ...(body.company !== undefined && { company: String(body.company) }),
      ...(body.roleTitle !== undefined && { roleTitle: String(body.roleTitle) }),
      ...(body.jobUrl !== undefined && { jobUrl: String(body.jobUrl) }),
      ...(body.workLocationType !== undefined && {
        workLocationType: String(body.workLocationType),
      }),
      ...(body.location !== undefined && { location: String(body.location) }),
      ...(body.salaryMin !== undefined && {
        salaryMin: body.salaryMin != null ? Number(body.salaryMin) : null,
      }),
      ...(body.salaryMax !== undefined && {
        salaryMax: body.salaryMax != null ? Number(body.salaryMax) : null,
      }),
      ...(body.dateApplied !== undefined && {
        dateApplied: body.dateApplied ? String(body.dateApplied) : null,
      }),
      ...(body.status !== undefined && { status: String(body.status) }),
      ...(body.notes !== undefined && { notes: String(body.notes) }),
      ...(body.interviewDate !== undefined && {
        interviewDate: body.interviewDate ? String(body.interviewDate) : null,
      }),
      updatedAt: timestamp,
    }),
  });
}

export function contactsRouter(db: Db) {
  return createCrudRouter({
    db,
    table: contacts,
    idCol: contacts.id,
    buildCreate: (body, id, timestamp) => ({
      id,
      applicationId: String(body.applicationId ?? ''),
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      linkedIn: String(body.linkedIn ?? ''),
      lastContactDate: body.lastContactDate
        ? String(body.lastContactDate)
        : null,
      messageNotes: String(body.messageNotes ?? ''),
      nextAction: String(body.nextAction ?? ''),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    buildUpdate: (body, timestamp) => ({
      ...(body.applicationId !== undefined && {
        applicationId: String(body.applicationId),
      }),
      ...(body.name !== undefined && { name: String(body.name) }),
      ...(body.email !== undefined && { email: String(body.email) }),
      ...(body.linkedIn !== undefined && { linkedIn: String(body.linkedIn) }),
      ...(body.lastContactDate !== undefined && {
        lastContactDate: body.lastContactDate
          ? String(body.lastContactDate)
          : null,
      }),
      ...(body.messageNotes !== undefined && {
        messageNotes: String(body.messageNotes),
      }),
      ...(body.nextAction !== undefined && {
        nextAction: String(body.nextAction),
      }),
      updatedAt: timestamp,
    }),
  });
}

export function communicationsRouter(db: Db) {
  return createCrudRouter({
    db,
    table: communications,
    idCol: communications.id,
    buildCreate: (body, id, timestamp) => ({
      id,
      applicationId: String(body.applicationId ?? ''),
      contactId: body.contactId ? String(body.contactId) : null,
      channel: String(body.channel ?? 'email'),
      direction: String(body.direction ?? 'outbound'),
      subject: String(body.subject ?? ''),
      body: String(body.body ?? ''),
      occurredAt: String(body.occurredAt ?? timestamp),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    buildUpdate: (body, timestamp) => ({
      ...(body.applicationId !== undefined && {
        applicationId: String(body.applicationId),
      }),
      ...(body.contactId !== undefined && {
        contactId: body.contactId ? String(body.contactId) : null,
      }),
      ...(body.channel !== undefined && { channel: String(body.channel) }),
      ...(body.direction !== undefined && { direction: String(body.direction) }),
      ...(body.subject !== undefined && { subject: String(body.subject) }),
      ...(body.body !== undefined && { body: String(body.body) }),
      ...(body.occurredAt !== undefined && {
        occurredAt: String(body.occurredAt),
      }),
      updatedAt: timestamp,
    }),
  });
}

export function followUpTasksRouter(db: Db) {
  return createCrudRouter({
    db,
    table: followUpTasks,
    idCol: followUpTasks.id,
    buildCreate: (body, id, timestamp) => ({
      id,
      applicationId: String(body.applicationId ?? ''),
      contactId: body.contactId ? String(body.contactId) : null,
      title: String(body.title ?? ''),
      description: String(body.description ?? ''),
      dueDate: String(body.dueDate ?? timestamp.slice(0, 10)),
      completed: Boolean(body.completed),
      completedAt: body.completedAt ? String(body.completedAt) : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    buildUpdate: (body, timestamp) => ({
      ...(body.applicationId !== undefined && {
        applicationId: String(body.applicationId),
      }),
      ...(body.contactId !== undefined && {
        contactId: body.contactId ? String(body.contactId) : null,
      }),
      ...(body.title !== undefined && { title: String(body.title) }),
      ...(body.description !== undefined && {
        description: String(body.description),
      }),
      ...(body.dueDate !== undefined && { dueDate: String(body.dueDate) }),
      ...(body.completed !== undefined && { completed: Boolean(body.completed) }),
      ...(body.completedAt !== undefined && {
        completedAt: body.completedAt ? String(body.completedAt) : null,
      }),
      updatedAt: timestamp,
    }),
  });
}

export function interviewsRouter(db: Db) {
  return createCrudRouter({
    db,
    table: interviews,
    idCol: interviews.id,
    buildCreate: (body, id, timestamp) => ({
      id,
      applicationId: String(body.applicationId ?? ''),
      scheduledAt: String(body.scheduledAt ?? timestamp),
      type: String(body.type ?? 'video'),
      location: String(body.location ?? ''),
      notes: String(body.notes ?? ''),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    buildUpdate: (body, timestamp) => ({
      ...(body.applicationId !== undefined && {
        applicationId: String(body.applicationId),
      }),
      ...(body.scheduledAt !== undefined && {
        scheduledAt: String(body.scheduledAt),
      }),
      ...(body.type !== undefined && { type: String(body.type) }),
      ...(body.location !== undefined && { location: String(body.location) }),
      ...(body.notes !== undefined && { notes: String(body.notes) }),
      updatedAt: timestamp,
    }),
  });
}

export function documentsRouter(db: Db) {
  return createCrudRouter({
    db,
    table: documents,
    idCol: documents.id,
    buildCreate: (body, id, timestamp) => ({
      id,
      applicationId: body.applicationId ? String(body.applicationId) : null,
      name: String(body.name ?? ''),
      type: String(body.type ?? 'other'),
      content: String(body.content ?? ''),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    buildUpdate: (body, timestamp) => ({
      ...(body.applicationId !== undefined && {
        applicationId: body.applicationId ? String(body.applicationId) : null,
      }),
      ...(body.name !== undefined && { name: String(body.name) }),
      ...(body.type !== undefined && { type: String(body.type) }),
      ...(body.content !== undefined && { content: String(body.content) }),
      updatedAt: timestamp,
    }),
  });
}
