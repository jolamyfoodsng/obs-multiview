import { deleteRecord, getAll, getByKey, putRecord, STORES } from "../services/db";
import type { ServicePlan, ServicePlanItem, ServicePlannerSnapshot } from "./types";
import { createServicePlan, createServicePlanItem, isServicePlan, isServicePlannerSnapshot } from "./types";

function sortPlans(plans: ServicePlan[]): ServicePlan[] {
  return [...plans].sort((a, b) => {
    const dateCompare = b.serviceDate.localeCompare(a.serviceDate);
    if (dateCompare !== 0) return dateCompare;
    return b.updatedAt - a.updatedAt;
  });
}

function withUpdatedAt(plan: ServicePlan): ServicePlan {
  return {
    ...plan,
    title: plan.title.trim() || "Untitled Service",
    completedItemIds: plan.completedItemIds ?? [],
    items: plan.items.map((item) => ({
      ...item,
      label: item.label.trim() || "Untitled cue",
      subtitle: item.subtitle?.trim(),
      notes: item.notes?.trim(),
      payloadSnapshot: item.payloadSnapshot ?? {},
    })),
    updatedAt: Date.now(),
  };
}

export async function getAllServicePlans(): Promise<ServicePlan[]> {
  return sortPlans(await getAll<ServicePlan>(STORES.SERVICE_PLANS));
}

export async function getServicePlan(id: string): Promise<ServicePlan | undefined> {
  return getByKey<ServicePlan>(STORES.SERVICE_PLANS, id);
}

export async function getActiveServicePlan(): Promise<ServicePlan | null> {
  const plans = await getAllServicePlans();
  return plans.find((plan) => plan.status === "active") ?? plans[0] ?? null;
}

export async function getServicePlannerSnapshot(): Promise<ServicePlannerSnapshot> {
  const plans = await getAllServicePlans();
  return {
    plans,
    activePlan: plans.find((plan) => plan.status === "active") ?? plans[0] ?? null,
  };
}

interface LegacyServicePlanItem {
  id?: string;
  type?: string;
  label?: string;
  details?: string;
  completed?: boolean;
  meta?: Record<string, unknown>;
}

interface LegacyServicePlan {
  id?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  items?: LegacyServicePlanItem[];
  notes?: string;
}

function coerceLegacyItem(item: LegacyServicePlanItem): ServicePlanItem | null {
  const rawType = item.type === "bible" || item.type === "worship" || item.type === "sermon" || item.type === "media"
    ? item.type
    : "sermon";
  const label = item.label?.trim() || rawType;
  const details = item.details?.trim() || "";
  const payloadSnapshot: Record<string, unknown> = item.meta && typeof item.meta === "object" ? { ...item.meta } : {};

  if (rawType === "worship") {
    payloadSnapshot.sectionText ??= details;
    payloadSnapshot.sectionLabel ??= label;
    payloadSnapshot.songTitle ??= label;
    payloadSnapshot.overlayMode ??= "lower-third";
  } else if (rawType === "bible") {
    payloadSnapshot.referenceLabel ??= label;
    payloadSnapshot.verseText ??= details;
    payloadSnapshot.translation ??= "KJV";
    payloadSnapshot.overlayMode ??= "fullscreen";
  } else if (rawType === "media") {
    payloadSnapshot.fileName ??= label;
  } else {
    payloadSnapshot.text ??= details || label;
    payloadSnapshot.itemType ??= "point";
    payloadSnapshot.overlayMode ??= "lower-third";
  }

  return createServicePlanItem({
    id: item.id,
    type: rawType,
    sourceKind: "manual",
    label,
    subtitle: details,
    notes: "",
    payloadSnapshot,
  });
}

function coerceLegacyPlan(plan: LegacyServicePlan): ServicePlan | null {
  const items = Array.isArray(plan.items)
    ? plan.items.map(coerceLegacyItem).filter((item): item is ServicePlanItem => Boolean(item))
    : [];
  return createServicePlan({
    id: plan.id,
    title: plan.name?.trim() || "Legacy Service Plan",
    serviceDate: plan.createdAt ? plan.createdAt.slice(0, 10) : undefined,
    status: "draft",
    items,
    completedItemIds: items
      .filter((_, index) => Boolean(plan.items?.[index]?.completed))
      .map((item) => item.id),
    createdAt: plan.createdAt ? new Date(plan.createdAt).getTime() : undefined,
    updatedAt: plan.updatedAt ? new Date(plan.updatedAt).getTime() : undefined,
  });
}

export async function importDockServicePlansPayload(payload: unknown): Promise<ServicePlannerSnapshot | null> {
  if (isServicePlannerSnapshot(payload)) {
    const plans = payload.plans.filter(isServicePlan);
    for (const plan of plans) {
      await putRecord<ServicePlan>(STORES.SERVICE_PLANS, plan);
    }
    return getServicePlannerSnapshot();
  }

  if (Array.isArray(payload)) {
    const plans = payload
      .map((plan) => coerceLegacyPlan(plan as LegacyServicePlan))
      .filter((plan): plan is ServicePlan => Boolean(plan));
    if (plans.length === 0) return null;
    for (const plan of plans) {
      await putRecord<ServicePlan>(STORES.SERVICE_PLANS, plan);
    }
    const snapshot = await getServicePlannerSnapshot();
    void syncServicePlansToDock();
    return snapshot;
  }

  return null;
}

export async function importDockServicePlansFromUploads(): Promise<ServicePlannerSnapshot | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("load_dock_data", { name: "dock-service-plans" });
    if (!raw.trim()) return null;
    return importDockServicePlansPayload(JSON.parse(raw) as unknown);
  } catch (err) {
    console.warn("[ServicePlanner] Failed to import dock service plan JSON:", err);
    return null;
  }
}

export async function saveServicePlan(plan: ServicePlan): Promise<ServicePlan> {
  const next = withUpdatedAt(plan);

  if (next.status === "active") {
    const plans = await getAllServicePlans();
    await Promise.all(
      plans
        .filter((candidate) => candidate.id !== next.id && candidate.status === "active")
        .map((candidate) =>
          putRecord<ServicePlan>(STORES.SERVICE_PLANS, {
            ...candidate,
            status: "draft",
            updatedAt: Date.now(),
          }),
        ),
    );
  }

  await putRecord<ServicePlan>(STORES.SERVICE_PLANS, next);
  void syncServicePlansToDock();
  return next;
}

export async function createNewServicePlan(input: Partial<ServicePlan> = {}): Promise<ServicePlan> {
  return saveServicePlan(createServicePlan(input));
}

export async function duplicateServicePlan(id: string): Promise<ServicePlan | null> {
  const source = await getServicePlan(id);
  if (!source) return null;
  const now = Date.now();
  const copy = createServicePlan({
    title: `${source.title} Copy`,
    serviceDate: source.serviceDate,
    status: "draft",
    items: source.items.map((item) => ({
      ...item,
      id: `cue-${crypto.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2, 8)}`}`,
      createdAt: now,
      updatedAt: now,
    })),
  });
  return saveServicePlan(copy);
}

export async function deleteServicePlan(id: string): Promise<void> {
  await deleteRecord(STORES.SERVICE_PLANS, id);
  void syncServicePlansToDock();
}

export async function syncServicePlansToDock(): Promise<void> {
  try {
    const [{ dockBridge }, snapshot] = await Promise.all([
      import("../services/dockBridge"),
      getServicePlannerSnapshot(),
    ]);
    dockBridge.sendState({
      type: "state:service-plans",
      payload: snapshot,
      timestamp: Date.now(),
    });

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_dock_data", {
        name: "dock-service-plans",
        data: JSON.stringify(snapshot),
      });
    } catch (err) {
      console.warn("[ServicePlanner] Failed to write dock service plan JSON:", err);
    }
  } catch (err) {
    console.warn("[ServicePlanner] Failed to sync planner state to dock:", err);
  }
}
