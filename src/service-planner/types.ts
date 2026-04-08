export type ServicePlanStatus = "draft" | "active" | "archived";

export type ServicePlanItemType = "bible" | "worship" | "sermon" | "media";

export type ServicePlanSourceKind =
  | "bible-reference"
  | "worship-song-section"
  | "sermon-quote"
  | "sermon-point"
  | "media-library-item"
  | "manual";

export interface ServicePlanItem {
  id: string;
  type: ServicePlanItemType;
  sourceId?: string;
  sourceKind?: ServicePlanSourceKind;
  label: string;
  subtitle?: string;
  notes?: string;
  payloadSnapshot: Record<string, unknown>;
  lastResolvedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ServicePlan {
  id: string;
  title: string;
  serviceDate: string;
  status: ServicePlanStatus;
  items: ServicePlanItem[];
  selectedItemId?: string;
  completedItemIds: string[];
  lastSentItemId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ServicePlannerSnapshot {
  plans: ServicePlan[];
  activePlan: ServicePlan | null;
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function todayServiceDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createServicePlan(partial: Partial<ServicePlan> = {}): ServicePlan {
  const now = Date.now();
  return {
    id: partial.id ?? makeId("plan"),
    title: partial.title?.trim() || "Sunday Service",
    serviceDate: partial.serviceDate || todayServiceDate(),
    status: partial.status ?? "active",
    items: partial.items ?? [],
    selectedItemId: partial.selectedItemId,
    completedItemIds: partial.completedItemIds ?? [],
    lastSentItemId: partial.lastSentItemId,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

export function isServicePlan(value: unknown): value is ServicePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<ServicePlan>;
  return Boolean(
    typeof plan.id === "string" &&
    typeof plan.title === "string" &&
    typeof plan.serviceDate === "string" &&
    Array.isArray(plan.items),
  );
}

export function isServicePlannerSnapshot(value: unknown): value is ServicePlannerSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ServicePlannerSnapshot>;
  return Array.isArray(snapshot.plans);
}

export function createServicePlanItem(
  input: Omit<ServicePlanItem, "id" | "createdAt" | "updatedAt"> & Partial<Pick<ServicePlanItem, "id" | "createdAt" | "updatedAt">>,
): ServicePlanItem {
  const now = Date.now();
  return {
    ...input,
    id: input.id ?? makeId("cue"),
    label: input.label.trim() || "Untitled cue",
    subtitle: input.subtitle?.trim(),
    notes: input.notes?.trim(),
    payloadSnapshot: input.payloadSnapshot ?? {},
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}
