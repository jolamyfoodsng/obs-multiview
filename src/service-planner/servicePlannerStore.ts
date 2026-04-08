import { deleteRecord, getAll, getByKey, putRecord, STORES } from "../services/db";
import type { ServicePlan, ServicePlannerSnapshot } from "./types";
import { createServicePlan } from "./types";

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
  } catch (err) {
    console.warn("[ServicePlanner] Failed to sync planner state to dock:", err);
  }
}
