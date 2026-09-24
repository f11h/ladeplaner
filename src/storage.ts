import { validateVehicleCargo } from './calculations'
import { initialSnapshot, LABELS, type Cargo, type LimitPoint, type LoadPlan,
  type PackList, type Placement, type Snapshot, type Vehicle } from './model'
import { loadedVehicle } from './plans'

export const STORAGE_KEY = 'lade-planer:v2'
const LEGACY_STORAGE_KEY = 'lade-planer:v1'

function record(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: Objekt erwartet.`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${context}: Text erwartet.`)
  return value
}

function number(value: unknown, context: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(`${context}: ${positive ? 'positive' : 'nichtnegative'} ganze Zahl erwartet.`)
  }
  return value
}

function unique(ids: string[], context: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`${context}: doppelte IDs.`)
}

function cargo(value: unknown): Cargo {
  const item = record(value, 'Ladungsträger')
  if (item.kind !== 'pallet' && item.kind !== 'cage' && item.kind !== 'rollcontainer') {
    throw new Error('Unbekannter Ladungsträgertyp.')
  }
  if (item.description !== undefined && typeof item.description !== 'string') {
    throw new Error('Beschreibung des Ladungsträgers: Text erwartet.')
  }
  return {
    id: text(item.id, 'Ladungsträger-ID'), kind: item.kind,
    name: item.name === undefined ? LABELS[item.kind] : text(item.name, 'Name des Ladungsträgers'),
    description: item.description ?? '',
    weight: number(item.weight, 'Gewicht'),
  }
}

function placement(value: unknown, legacy = false): Placement {
  const entry = record(value, 'Position')
  if (entry.orientation !== 'long' && entry.orientation !== 'cross') {
    throw new Error('Unbekannte Ausrichtung.')
  }
  return {
    cargoId: text(legacy ? entry.id : entry.cargoId, 'Ladungsträger-Referenz'),
    orientation: entry.orientation,
    x: number(entry.x, 'Position längs'),
    y: number(entry.y, 'Position quer'),
  }
}

function limit(value: unknown): LimitPoint {
  const point = record(value, 'Stützstelle')
  return {
    id: text(point.id, 'Stützstellen-ID'),
    distance: number(point.distance, 'Abstand'),
    weight: number(point.weight, 'Zulässiges Gewicht'),
  }
}

function vehicle(value: unknown): Vehicle {
  const entry = record(value, 'Fahrzeug')
  if (!Array.isArray(entry.limits)) throw new Error('Fahrzeug: Stützstellen müssen eine Liste sein.')
  const result: Vehicle = {
    id: text(entry.id, 'Fahrzeug-ID'),
    name: text(entry.name, 'Fahrzeugname'),
    length: number(entry.length, 'Länge', true),
    width: number(entry.width, 'Breite', true),
    maxPayload: entry.maxPayload == null ? null : number(entry.maxPayload, 'Zulässige Zuladung'),
    limits: entry.limits.map(limit),
  }
  unique(result.limits.map(point => point.id), 'Stützstellen')
  unique(result.limits.map(point => String(point.distance)), 'Abstände')
  if (result.limits.some(point => point.distance > result.length)) {
    throw new Error(`${result.name}: Stützstelle liegt außerhalb der Ladefläche.`)
  }
  return result
}

function migrateLegacy(data: Record<string, unknown>): Snapshot {
  if (!Array.isArray(data.vehicles) || !data.vehicles.length) {
    throw new Error('Mindestens ein Fahrzeug ist erforderlich.')
  }
  const vehicles: Vehicle[] = []
  const packLists: PackList[] = []
  const plans: LoadPlan[] = []
  for (const raw of data.vehicles) {
    const entry = record(raw, 'Fahrzeug')
    if (!Array.isArray(entry.cargo)) throw new Error('Fahrzeug: Ladeeinheiten müssen eine Liste sein.')
    const parsedVehicle = vehicle(entry)
    const packList: PackList = {
      id: `packlist:${parsedVehicle.id}`, name: `${parsedVehicle.name} – Ladung`,
      cargo: entry.cargo.map(cargo),
    }
    unique(packList.cargo.map(item => item.id), 'Ladungsträger')
    const plan: LoadPlan = {
      vehicleId: parsedVehicle.id, packListId: packList.id,
      placements: entry.cargo.map(item => placement(item, true)),
    }
    const error = validateVehicleCargo(loadedVehicle(parsedVehicle, packList, plan))
    if (error) throw new Error(`${parsedVehicle.name}: ${error}`)
    vehicles.push(parsedVehicle)
    packLists.push(packList)
    plans.push(plan)
  }
  unique(vehicles.map(entry => entry.id), 'Fahrzeuge')
  const activeVehicleId = text(data.activeVehicleId, 'Aktives Fahrzeug')
  if (!vehicles.some(entry => entry.id === activeVehicleId)) {
    throw new Error('Das aktive Fahrzeug ist nicht in der Datei enthalten.')
  }
  return {
    version: 2, vehicles, packLists, plans, activeVehicleId,
    activePackListId: `packlist:${activeVehicleId}`,
  }
}

export function parseSnapshot(value: unknown): Snapshot {
  const data = record(value, 'Import')
  if (data.version === 1) return migrateLegacy(data)
  if (data.version !== 2) throw new Error('Nicht unterstützte Dateiversion (erwartet: 1 oder 2).')
  if (!Array.isArray(data.vehicles) || !data.vehicles.length ||
      !Array.isArray(data.packLists) || !data.packLists.length ||
      !Array.isArray(data.plans)) {
    throw new Error('Fahrzeuge, Packlisten und Ladepläne müssen Listen sein.')
  }
  const vehicles: Vehicle[] = data.vehicles.map(vehicle)
  const packLists: PackList[] = data.packLists.map((raw: unknown) => {
    const entry = record(raw, 'Packliste')
    if (!Array.isArray(entry.cargo)) throw new Error('Packliste: Ladungsträger müssen eine Liste sein.')
    const list: PackList = {
      id: text(entry.id, 'Packlisten-ID'), name: text(entry.name, 'Packlistenname'),
      cargo: entry.cargo.map(cargo),
    }
    unique(list.cargo.map(item => item.id), 'Ladungsträger')
    return list
  })
  unique(vehicles.map(entry => entry.id), 'Fahrzeuge')
  unique(packLists.map(entry => entry.id), 'Packlisten')
  const plans: LoadPlan[] = data.plans.map((raw: unknown) => {
    const entry = record(raw, 'Ladeplan')
    if (!Array.isArray(entry.placements)) throw new Error('Ladeplan: Positionen müssen eine Liste sein.')
    const plan: LoadPlan = {
      vehicleId: text(entry.vehicleId, 'Fahrzeug-Referenz'),
      packListId: text(entry.packListId, 'Packlisten-Referenz'),
      placements: entry.placements.map(item => placement(item)),
    }
    const truck = vehicles.find(item => item.id === plan.vehicleId)
    const list = packLists.find(item => item.id === plan.packListId)
    if (!truck || !list) throw new Error('Ladeplan verweist auf ein unbekanntes Fahrzeug oder eine Packliste.')
    unique(plan.placements.map(item => item.cargoId), 'Positionen')
    if (plan.placements.some(item => !list.cargo.some(c => c.id === item.cargoId))) {
      throw new Error('Ladeplan verweist auf einen unbekannten Ladungsträger.')
    }
    const error = validateVehicleCargo(loadedVehicle(truck, list, plan))
    if (error) throw new Error(`${truck.name} / ${list.name}: ${error}`)
    return plan
  })
  unique(plans.map(plan => `${plan.vehicleId}\0${plan.packListId}`), 'Ladepläne')
  const activeVehicleId = text(data.activeVehicleId, 'Aktives Fahrzeug')
  const activePackListId = text(data.activePackListId, 'Aktive Packliste')
  if (!plans.some(plan => plan.vehicleId === activeVehicleId &&
      plan.packListId === activePackListId)) {
    throw new Error('Für die aktive Fahrzeug-Packlisten-Kombination fehlt ein Ladeplan.')
  }
  return { version: 2, activeVehicleId, activePackListId, vehicles, packLists, plans }
}

export function loadSnapshot(): { snapshot: Snapshot; error: string | null } {
  let saved: string | null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
    if (saved === null) saved = localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch (error) {
    return { snapshot: initialSnapshot(), error: `Lokaler Speicher nicht verfügbar: ${String(error)}` }
  }
  if (saved === null) return { snapshot: initialSnapshot(), error: null }
  try {
    const value: unknown = JSON.parse(saved)
    return { snapshot: parseSnapshot(value), error: null }
  } catch (error) {
    if (error instanceof Error) {
      return { snapshot: initialSnapshot(), error: `Gespeicherte Daten ungültig: ${error.message}` }
    }
    throw error
  }
}
