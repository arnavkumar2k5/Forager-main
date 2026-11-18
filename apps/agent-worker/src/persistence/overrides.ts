import {
  PropositionRepository,
  TrajectoryRepository,
  ExecutionRepository,
  ScentRepository,
  NotificationRepository,
} from "@repo/database";

let propositionRepoOverride: PropositionRepository | null = null;
let trajectoryRepoOverride: TrajectoryRepository | null = null;
let executionRepoOverride: ExecutionRepository | null = null;
let scentRepoOverride: ScentRepository | null = null;
let notificationRepoOverride: NotificationRepository | null = null;

export function setPropositionRepository(repo: PropositionRepository | null): void {
  propositionRepoOverride = repo;
}

export function getPropositionRepoOverride(): PropositionRepository | null {
  return propositionRepoOverride;
}

export function setTrajectoryRepository(repo: TrajectoryRepository | null): void {
  trajectoryRepoOverride = repo;
}

export function getTrajectoryRepoOverride(): TrajectoryRepository | null {
  return trajectoryRepoOverride;
}

export function setExecutionRepository(repo: ExecutionRepository | null): void {
  executionRepoOverride = repo;
}

export function getExecutionRepoOverride(): ExecutionRepository | null {
  return executionRepoOverride;
}

export function setScentRepository(repo: ScentRepository | null): void {
  scentRepoOverride = repo;
}

export function getScentRepoOverride(): ScentRepository | null {
  return scentRepoOverride;
}

export function setNotificationRepository(repo: NotificationRepository | null): void {
  notificationRepoOverride = repo;
}

export function getNotificationRepoOverride(): NotificationRepository | null {
  return notificationRepoOverride;
}

