import { validatePlacement, validateVehicleCargo } from './calculations'
import { type Cargo, type LoadPlan, type LoadedVehicle, type PackList, type Placement, type Snapshot, type Vehicle } from './model'

export function getPlan(snapshot: Snapshot, vehicleId = snapshot.activeVehicleId,
  packListId = snapshot.activePackListId): LoadPlan | undefined {
  return snapshot.plans.find(plan => plan.vehicleId === vehicleId && plan.packListId === packListId)
}

export function loadedVehicle(vehicle: Vehicle, packList: PackList, plan?: LoadPlan): LoadedVehicle {
  const cargoById = new Map(packList.cargo.map(item => [item.id, item]))
  return {
    ...vehicle,
    cargo: (plan?.placements ?? []).map(placement => {
      const item = cargoById.get(placement.cargoId)
      if (!item) throw new Error(`Ladeplan enthält unbekannten Ladungsträger: ${placement.cargoId}`)
      return { ...item, orientation: placement.orientation, x: placement.x, y: placement.y }
    }),
  }
}

export function withPlan(snapshot: Snapshot, plan: LoadPlan): Snapshot {
  return {
    ...snapshot,
    plans: [...snapshot.plans.filter(entry =>
      entry.vehicleId !== plan.vehicleId || entry.packListId !== plan.packListId), plan],
  }
}

export function unloadCargo(plan: LoadPlan, cargoId: string): LoadPlan {
  if (!plan.placements.some(placement => placement.cargoId === cargoId)) {
    throw new Error(`Ladungsträger ${cargoId} ist in diesem Ladeplan nicht verladen.`)
  }
  return { ...plan, placements: plan.placements.filter(placement => placement.cargoId !== cargoId) }
}

export function cargoChangeError(snapshot: Snapshot, packListId: string, nextCargo: Cargo): string | null {
  const packList = snapshot.packLists.find(entry => entry.id === packListId)
  if (!packList) throw new Error(`Packliste ${packListId} existiert nicht.`)
  const updated: PackList = {
    ...packList,
    cargo: packList.cargo.map(item => item.id === nextCargo.id ? nextCargo : item),
  }
  for (const plan of snapshot.plans.filter(entry => entry.packListId === packListId)) {
    const vehicle = snapshot.vehicles.find(entry => entry.id === plan.vehicleId)
    if (!vehicle) throw new Error(`Fahrzeug ${plan.vehicleId} existiert nicht.`)
    const error = validateVehicleCargo(loadedVehicle(vehicle, updated, plan))
    if (error) return `${vehicle.name}: ${error}`
  }
  return null
}

export function transferPlan(vehicle: Vehicle, packList: PackList, source?: LoadPlan): {
  plan: LoadPlan
  skipped: number
} {
  const placements: Placement[] = []
  const cargoById = new Map(packList.cargo.map(item => [item.id, item]))
  for (const placement of source?.placements ?? []) {
    const cargo = cargoById.get(placement.cargoId)
    if (!cargo) throw new Error(`Ladeplan enthält unbekannten Ladungsträger: ${placement.cargoId}`)
    const candidate = { ...cargo, ...placement, id: cargo.id }
    if (validatePlacement(loadedVehicle(vehicle, packList, {
      vehicleId: vehicle.id, packListId: packList.id, placements,
    }), candidate) === null) placements.push(placement)
  }
  return {
    plan: { vehicleId: vehicle.id, packListId: packList.id, placements },
    skipped: (source?.placements.length ?? 0) - placements.length,
  }
}
