import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publishNotification(identityId, event) {
  if (!identityId) return;
  bus.emit(`identity:${identityId}`, { ...event, sentAt: new Date().toISOString() });
}

export function subscribeNotifications(identityId, listener) {
  const channel = `identity:${identityId}`;
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}

export async function deliverNotification(persistence, {
  context,
  recipientId,
  category,
  entityType = null,
  entityId = null,
  payload = {}
}) {
  if (!recipientId || recipientId === context?.actor?.id) return null;
  const notification = {
    id: crypto.randomUUID(),
    workspaceId: context?.workspace?.id || null,
    category,
    entityType,
    entityId,
    payload,
    readAt: null,
    archivedAt: null,
    createdAt: new Date().toISOString()
  };
  const created = typeof persistence?.notifications?.create === "function"
    ? await persistence.notifications.create(context, { ...notification, recipientId })
    : notification;
  publishNotification(recipientId, { type: "notification", notification: created });
  return created;
}
