import { Proposition, ScentMetric, ScoutNotification } from "@repo/types";

export const inMemoryPropositionStore = new Map<string, Proposition[]>();
export const inMemoryScentMetricsStore = new Map<string, ScentMetric[]>();
export const inMemoryNotificationsStore = new Map<string, ScoutNotification[]>();

export function clearInMemoryScentMetrics(): void {
  inMemoryScentMetricsStore.clear();
}

export function getInMemoryScentMetrics(scoutId: string): ScentMetric[] {
  return inMemoryScentMetricsStore.get(scoutId) || [];
}

export function storeInMemoryPropositions(scoutId: string, propositions: Proposition[]): void {
  const existing = inMemoryPropositionStore.get(scoutId) || [];
  const existingContents = new Set(existing.map((p) => p.content.trim().toLowerCase()));
  const existingIds = new Set(existing.map((p) => p.id));

  const uniqueToAdd = propositions.filter(
    (p) => !existingIds.has(p.id) && !existingContents.has(p.content.trim().toLowerCase())
  );
  inMemoryPropositionStore.set(scoutId, [...existing, ...uniqueToAdd]);
}

export function getInMemoryPropositions(scoutId: string): Proposition[] {
  return inMemoryPropositionStore.get(scoutId) || [];
}

export function clearInMemoryPropositions(): void {
  inMemoryPropositionStore.clear();
}

export function storeInMemoryNotification(notification: ScoutNotification): void {
  const existing = inMemoryNotificationsStore.get(notification.scoutId) || [];
  inMemoryNotificationsStore.set(notification.scoutId, [notification, ...existing]);
}

export function getInMemoryNotifications(scoutId: string): ScoutNotification[] {
  return inMemoryNotificationsStore.get(scoutId) || [];
}

export function markInMemoryNotificationRead(notificationId: string): void {
  for (const [scoutId, notifs] of inMemoryNotificationsStore.entries()) {
    const updated = notifs.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
    inMemoryNotificationsStore.set(scoutId, updated);
  }
}

export function clearInMemoryNotifications(): void {
  inMemoryNotificationsStore.clear();
}

