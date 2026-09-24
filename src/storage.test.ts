import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSnapshot, parseSnapshot, STORAGE_KEY } from './storage'
import { type Snapshot } from './model'

const sample = (): Snapshot => ({
  version: 2, activeVehicleId: 'truck', activePackListId: 'list',
  vehicles: [
    { id: 'truck', name: 'LKW', length: 500, width: 248, maxPayload: 2000,
      limits: [{ id: 'limit', distance: 200, weight: 2000 }] },
    { id: 'other', name: 'Weiterer LKW', length: 600, width: 250, maxPayload: null, limits: [] },
  ],
  packLists: [{
    id: 'list', name: 'Auftrag A', cargo: [
      { id: 'p', kind: 'pallet', name: 'Werkzeug', description: 'Kiste 1', weight: 100 },
      { id: 'q', kind: 'cage', name: 'Teile', description: '', weight: 120 },
    ],
  }],
  plans: [
    { vehicleId: 'truck', packListId: 'list',
      placements: [{ cargoId: 'p', orientation: 'long', x: 0, y: 0 }] },
    { vehicleId: 'other', packListId: 'list',
      placements: [{ cargoId: 'p', orientation: 'cross', x: 30, y: 0 }] },
  ],
})

const legacy = () => ({
  version: 1, activeVehicleId: 'a', vehicles: [{
    id: 'a', name: 'Altes Fahrzeug', length: 500, width: 248,
    cargo: [{ id: 'p', kind: 'pallet', orientation: 'long',
      x: 0, y: 0, weight: 100 }],
    limits: [],
  }],
})

afterEach(() => vi.unstubAllGlobals())

describe('JSON-Import und Migration', () => {
  it('erhält Packliste und getrennte Ladepläne bei Export/Import', () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(sample())))).toEqual(sample())
  })
  it('importiert Rollcontainer in bestehenden Packlisten und Ladeplänen', () => {
    const data = sample()
    data.packLists[0].cargo[0].kind = 'rollcontainer'
    expect(parseSnapshot(JSON.parse(JSON.stringify(data)))).toEqual(data)
  })
  it('migriert bestehende Fahrzeuge verlustfrei in separate Packlisten und Pläne', () => {
    const old = legacy()
    old.vehicles.push({
      ...old.vehicles[0], id: 'b', name: 'Zweites Fahrzeug',
      cargo: [{ ...old.vehicles[0].cargo[0], id: 'q', x: 120 }],
    })
    const migrated = parseSnapshot(old)
    expect(migrated.version).toBe(2)
    expect(migrated.packLists[0].cargo[0]).toMatchObject({
      id: 'p', name: 'Europalette', description: '', weight: 100,
    })
    expect(migrated.plans[0].placements[0]).toEqual({
      cargoId: 'p', orientation: 'long', x: 0, y: 0,
    })
    expect(migrated.packLists).toHaveLength(2)
    expect(migrated.plans[1].placements[0].cargoId).toBe('q')
    expect(migrated.vehicles[0]).not.toHaveProperty('cargo')
    expect(migrated.vehicles[0].maxPayload).toBeNull()
  })
  it('liest bestehende lokale Daten, wenn noch kein neuer Speicherstand vorhanden ist', () => {
    const saved = JSON.stringify(legacy())
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === STORAGE_KEY ? null : saved,
    })
    expect(loadSnapshot().snapshot.packLists[0].cargo[0].id).toBe('p')
  })
  it('behält Version-2-Fahrzeuge ohne bisherige Zuladungsangabe bei', () => {
    const old = JSON.parse(JSON.stringify(sample()))
    delete old.vehicles[0].maxPayload
    expect(parseSnapshot(old).vehicles[0].maxPayload).toBeNull()
  })
  it('weist falsche Versionen und ungültige Referenzen zurück', () => {
    expect(() => parseSnapshot({ ...sample(), version: 3 })).toThrow(/Dateiversion/)
    expect(() => parseSnapshot({ ...sample(), activeVehicleId: 'missing' })).toThrow(/aktive Fahrzeug/)
    const unknownCargo = sample()
    unknownCargo.plans[0].placements[0].cargoId = 'missing'
    expect(() => parseSnapshot(unknownCargo)).toThrow(/unbekannten Ladungsträger/)
  })
  it('weist ungültige Ladepläne, doppelte Kombinationen und Texte zurück', () => {
    const badPlacement = sample()
    badPlacement.plans[0].placements[0].y = 200
    expect(() => parseSnapshot(badPlacement)).toThrow(/innerhalb/)
    const duplicate = sample()
    duplicate.plans.push(duplicate.plans[0])
    expect(() => parseSnapshot(duplicate)).toThrow(/doppelte IDs/)
    const badName = sample()
    badName.packLists[0].cargo[0].name = ''
    expect(() => parseSnapshot(badName)).toThrow(/Name des Ladungsträgers/)
    const badPayload = sample()
    badPayload.vehicles[0].maxPayload = -1
    expect(() => parseSnapshot(badPayload)).toThrow(/Zulässige Zuladung/)
  })
})
