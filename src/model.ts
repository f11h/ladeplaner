export type CargoKind = 'pallet' | 'cage' | 'rollcontainer'
export type Orientation = 'long' | 'cross'

export interface Cargo {
  id: string
  kind: CargoKind
  name: string
  description: string
  weight: number
}

export interface Placement {
  cargoId: string
  orientation: Orientation
  x: number
  y: number
}

export interface PlacedCargo extends Cargo {
  orientation: Orientation
  x: number
  y: number
}

export interface LimitPoint {
  id: string
  distance: number
  weight: number
}

export interface Vehicle {
  id: string
  name: string
  length: number
  width: number
  maxPayload: number | null
  limits: LimitPoint[]
}

export interface LoadedVehicle extends Vehicle {
  cargo: PlacedCargo[]
}

export interface PackList {
  id: string
  name: string
  cargo: Cargo[]
}

export interface LoadPlan {
  vehicleId: string
  packListId: string
  placements: Placement[]
}

export interface Snapshot {
  version: 2
  activeVehicleId: string
  activePackListId: string
  vehicles: Vehicle[]
  packLists: PackList[]
  plans: LoadPlan[]
}

export const LABELS: Record<CargoKind, string> = {
  pallet: 'Europalette',
  cage: 'Euro-Gitterbox',
  rollcontainer: 'Rollcontainer',
}

export const SYMBOLS: Record<CargoKind, string> = {
  pallet: '▤',
  cage: '▦',
  rollcontainer: '▥',
}

export function footprint(item: Pick<PlacedCargo, 'kind' | 'orientation'>) {
  const across = item.kind === 'cage' ? 83 : 80
  const along = item.kind === 'cage' ? 123 : 120
  return item.orientation === 'long'
    ? { length: along, width: across }
    : { length: across, width: along }
}

export function rotateCargo(item: PlacedCargo): PlacedCargo {
  return { ...item, orientation: item.orientation === 'long' ? 'cross' : 'long' }
}

export function newVehicle(name: string): Vehicle {
  return { id: crypto.randomUUID(), name, length: 1360, width: 248, maxPayload: null, limits: [] }
}

export function initialSnapshot(): Snapshot {
  const vehicle = newVehicle('Mein LKW')
  const packList: PackList = { id: crypto.randomUUID(), name: 'Meine Packliste', cargo: [] }
  return {
    version: 2, activeVehicleId: vehicle.id, activePackListId: packList.id,
    vehicles: [vehicle], packLists: [packList],
    plans: [{ vehicleId: vehicle.id, packListId: packList.id, placements: [] }],
  }
}
