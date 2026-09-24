import { describe, expect, it } from 'vitest'
import { cargoChangeError, getPlan, loadedVehicle, transferPlan, unloadCargo, withPlan } from './plans'
import { type PackList, type Snapshot, type Vehicle } from './model'

const packList: PackList = {
  id: 'list', name: 'Auftrag', cargo: [
    { id: 'a', name: 'A', description: '', kind: 'pallet', weight: 100 },
    { id: 'b', name: 'B', description: '', kind: 'pallet', weight: 250 },
    { id: 'c', name: 'C', description: '', kind: 'cage', weight: 300 },
  ],
}
const truck = (id: string, length: number, width: number): Vehicle =>
  ({ id, name: id, length, width, maxPayload: null, limits: [] })

describe('fahrzeugunabhängige Packlisten', () => {
  it('verknüpft Pläne mit Packlisten und übernimmt spätere Gewichtsänderungen', () => {
    const vehicle = truck('large', 600, 248)
    const plan = { vehicleId: 'large', packListId: 'list',
      placements: [{ cargoId: 'a', x: 0, y: 0, orientation: 'long' as const }] }
    expect(loadedVehicle(vehicle, packList, plan).cargo[0].weight).toBe(100)
    const updated = { ...packList, cargo: packList.cargo.map(item =>
      item.id === 'a' ? { ...item, weight: 180 } : item) }
    expect(loadedVehicle(vehicle, updated, plan).cargo[0].weight).toBe(180)
  })
  it('überträgt passende Positionen und markiert unpassende als unverladen', () => {
    const source = { vehicleId: 'large', packListId: 'list', placements: [
      { cargoId: 'a', x: 0, y: 0, orientation: 'long' as const },
      { cargoId: 'b', x: 150, y: 0, orientation: 'long' as const },
      { cargoId: 'c', x: 350, y: 0, orientation: 'long' as const },
    ] }
    const target = truck('small', 300, 248)
    const result = transferPlan(target, packList, source)
    expect(result.plan.placements.map(item => item.cargoId)).toEqual(['a', 'b'])
    expect(result.skipped).toBe(1)
    expect(packList.cargo).toHaveLength(3)
  })
  it('speichert verschiedene Positionen je Fahrzeug-Packlisten-Kombination', () => {
    const first = transferPlan(truck('one', 600, 248), packList).plan
    const second = transferPlan(truck('two', 600, 248), packList).plan
    const snapshot: Snapshot = {
      version: 2, vehicles: [truck('one', 600, 248), truck('two', 600, 248)],
      packLists: [packList], plans: [first],
      activeVehicleId: 'one', activePackListId: 'list',
    }
    const updated = withPlan(withPlan(snapshot, {
      ...first, placements: [{ cargoId: 'a', x: 0, y: 0, orientation: 'long' }],
    }), { ...second, placements: [{ cargoId: 'a', x: 200, y: 0, orientation: 'long' }] })
    expect(getPlan(updated, 'one', 'list')?.placements[0].x).toBe(0)
    expect(getPlan(updated, 'two', 'list')?.placements[0].x).toBe(200)
  })
  it('entlädt nur den aktuellen Ladeplan und lässt Packliste und anderen Ladeplan unverändert', () => {
    const first = { vehicleId: 'one', packListId: 'list', placements: [
      { cargoId: 'a', x: 0, y: 0, orientation: 'long' as const },
      { cargoId: 'b', x: 0, y: 80, orientation: 'long' as const },
    ] }
    const second = { vehicleId: 'two', packListId: 'list', placements: [
      { cargoId: 'a', x: 200, y: 0, orientation: 'long' as const },
    ] }
    const snapshot: Snapshot = {
      version: 2, vehicles: [truck('one', 600, 248), truck('two', 600, 248)],
      packLists: [packList], plans: [first, second],
      activeVehicleId: 'one', activePackListId: 'list',
    }
    const next = withPlan(snapshot, unloadCargo(first, 'a'))
    expect(getPlan(next, 'one', 'list')?.placements.map(item => item.cargoId)).toEqual(['b'])
    expect(getPlan(next, 'two', 'list')?.placements).toEqual(second.placements)
    expect(next.packLists[0].cargo.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(() => unloadCargo(next.plans.find(plan => plan.vehicleId === 'one')!, 'a'))
      .toThrow(/nicht verladen/)
  })
  it('verweigert Typänderungen, die einen gespeicherten Ladeplan ungültig machen', () => {
    const snapshot: Snapshot = {
      version: 2, activeVehicleId: 'one', activePackListId: 'list',
      vehicles: [truck('one', 500, 250), truck('two', 120, 248)],
      packLists: [packList],
      plans: [
        { vehicleId: 'one', packListId: 'list',
          placements: [{ cargoId: 'a', x: 0, y: 0, orientation: 'long' }] },
        { vehicleId: 'two', packListId: 'list',
          placements: [{ cargoId: 'a', x: 0, y: 0, orientation: 'long' }] },
      ],
    }
    expect(cargoChangeError(snapshot, 'list', { ...packList.cargo[0], kind: 'cage' }))
      .toMatch(/two.*innerhalb/)
    expect(cargoChangeError(snapshot, 'list', {
      ...packList.cargo[0], kind: 'rollcontainer', weight: 900,
    })).toBeNull()
  })
})
