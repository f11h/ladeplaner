import { describe, expect, it } from 'vitest'
import { allowedAt, analyzeLoad, analyzeSections, sectionWeightAt,
  snapPlacement, validatePlacement, validateVehicleCargo } from './calculations'
import { footprint, rotateCargo, type LoadedVehicle, type PlacedCargo } from './model'

const vehicle = (width = 248): LoadedVehicle => ({
  id: 'truck', name: 'LKW', length: 1360, width, maxPayload: null, cargo: [], limits: [],
})
const item = (id: string, kind: PlacedCargo['kind'], y: number,
  orientation: PlacedCargo['orientation'] = 'long', x = 0): PlacedCargo =>
  ({ id, kind, name: 'Ladung', description: 'Testinhalt', x, y, orientation, weight: 100 })

describe('Ladeflächenregeln', () => {
  it('verwendet die echten Maße für alle Typen und Ausrichtungen', () => {
    expect(footprint(item('a', 'pallet', 0))).toEqual({ length: 120, width: 80 })
    expect(footprint(item('a', 'cage', 0, 'cross'))).toEqual({ length: 83, width: 123 })
    expect(footprint(item('a', 'rollcontainer', 0))).toEqual({ length: 120, width: 80 })
    expect(footprint(item('a', 'rollcontainer', 0, 'cross'))).toEqual({ length: 80, width: 120 })
  })

  it('dreht um 90 Grad und erhält Name, Beschreibung und Gewicht', () => {
    const original = item('a', 'pallet', 0)
    const rotated = rotateCargo(original)
    expect(footprint(rotated)).toEqual({ length: 80, width: 120 })
    expect(rotateCargo(rotated)).toEqual(original)
    expect(validatePlacement({ ...vehicle(90), cargo: [original] }, rotated)).toMatch(/innerhalb/)
  })

  describe('Einrasten ohne Raster', () => {
    it('rastet an Stirnwand und linker Ladeflächenwand gleichzeitig ein', () => {
      const candidate = item('a', 'pallet', 6, 'long', 7)
      expect(snapPlacement(vehicle(), candidate)).toEqual({ ...candidate, x: 0, y: 0 })
    })

    it('rastet an hinterer und rechter Wand ein', () => {
      const candidate = item('a', 'pallet', 163, 'long', 1235)
      expect(snapPlacement(vehicle(), candidate)).toEqual({ ...candidate, x: 1240, y: 168 })
    })

    it('rastet an Kanten bestehender Einheiten längs und quer ein', () => {
      const truck = { ...vehicle(), cargo: [item('a', 'pallet', 0)] }
      expect(snapPlacement(truck, item('b', 'cage', 76, 'long', 3))).toMatchObject({ x: 0, y: 80 })
      expect(snapPlacement(truck, item('b', 'pallet', 80, 'long', 115))).toMatchObject({ x: 120, y: 80 })
    })

    it('behält freie Zentimeterpositionen ohne nahen Anker unverändert bei', () => {
      const candidate = item('b', 'pallet', 137, 'long', 347)
      expect(snapPlacement(vehicle(), candidate)).toEqual(candidate)
    })

    it('rastet nie auf kollidierende oder regelwidrige Positionen ein', () => {
      const truck = { ...vehicle(260), cargo: [item('a', 'cage', 0), item('b', 'cage', 83)] }
      const candidate = item('c', 'cage', 165)
      expect(snapPlacement(truck, candidate)).toEqual(candidate)
      expect(validatePlacement(truck, candidate)).not.toBeNull()
    })

    it('verwendet beim Verschieben nicht die eigenen Kanten als Magnet', () => {
      const original = item('a', 'pallet', 60, 'long', 300)
      const truck = { ...vehicle(), cargo: [original] }
      expect(snapPlacement(truck, { ...original, x: 304, y: 64 })).toMatchObject({ x: 304, y: 64 })
    })

    it('zentriert eine Palette zwischen zwei Einheiten über die Breite', () => {
      const truck = { ...vehicle(400), cargo: [
        item('a', 'pallet', 0), item('b', 'pallet', 260),
      ] }
      expect(snapPlacement(truck, item('c', 'pallet', 126))).toMatchObject({ x: 0, y: 130 })
    })

    it('bevorzugt in einem schmalen Zwischenraum die Mitte vor den nahen Kanten', () => {
      const truck = { ...vehicle(), cargo: [
        item('a', 'pallet', 0), item('b', 'pallet', 168),
      ] }
      expect(snapPlacement(truck, item('c', 'pallet', 81))).toMatchObject({ x: 0, y: 84 })
    })

    it('zentriert eine Palette zwischen zwei Einheiten in Längsrichtung', () => {
      const truck = { ...vehicle(), cargo: [
        item('a', 'pallet', 0, 'long', 0), item('b', 'pallet', 0, 'long', 340),
      ] }
      expect(snapPlacement(truck, item('c', 'pallet', 0, 'long', 166)))
        .toMatchObject({ x: 170, y: 0 })
    })

    it('zentriert nicht in zu schmalen oder versetzt liegenden Zwischenräumen', () => {
      const tooNarrow = { ...vehicle(400), cargo: [
        item('a', 'pallet', 0), item('b', 'pallet', 150),
      ] }
      const candidate = item('c', 'pallet', 111)
      expect(snapPlacement(tooNarrow, candidate)).toEqual(candidate)

      const diagonal = { ...vehicle(), cargo: [
        item('a', 'pallet', 0, 'long', 0), item('b', 'pallet', 160, 'long', 340),
      ] }
      const between = item('c', 'pallet', 0, 'long', 166)
      expect(snapPlacement(diagonal, between)).toEqual(between)
    })
  })

  it('erlaubt drei Längspaletten und zwei Gitterboxen mit einer Palette', () => {
    const pallets = { ...vehicle(), cargo: [item('a', 'pallet', 0), item('b', 'pallet', 80)] }
    expect(validatePlacement(pallets, item('c', 'pallet', 160))).toBeNull()
    const mixed = { ...vehicle(), cargo: [item('a', 'cage', 0), item('b', 'cage', 83)] }
    expect(validatePlacement(mixed, item('c', 'pallet', 166))).toBeNull()
    expect(validatePlacement(mixed, item('c', 'rollcontainer', 166))).toBeNull()
    expect(validatePlacement({
      ...vehicle(), cargo: [item('a', 'rollcontainer', 0), item('b', 'pallet', 80)],
    }, item('c', 'rollcontainer', 160))).toBeNull()
  })

  it('verbietet drei Gitterboxen auch auf einer breiten Ladefläche', () => {
    const truck = { ...vehicle(260), cargo: [item('a', 'cage', 0), item('b', 'cage', 83)] }
    expect(validatePlacement(truck, item('c', 'cage', 166))).toMatch(/maximal 2 Gitterboxen/)
  })

  it('verbietet zwei gedrehte Gitterboxen, erlaubt gedrehte Palette daneben', () => {
    const truck = { ...vehicle(260), cargo: [item('a', 'cage', 0, 'cross')] }
    expect(validatePlacement(truck, item('b', 'cage', 123, 'cross'))).toMatch(/maximal 1 Gitterbox/)
    expect(validatePlacement(truck, item('b', 'pallet', 123, 'cross'))).toBeNull()
    expect(validatePlacement(truck, item('b', 'rollcontainer', 123, 'cross'))).toBeNull()
  })

  it('verbietet gemischte Ausrichtungen und versetzte Reihen mit Längsüberlappung', () => {
    const truck = { ...vehicle(260), cargo: [item('a', 'pallet', 0, 'long', 0)] }
    expect(validatePlacement(truck, item('b', 'cage', 80, 'cross', 80))).toMatch(/nicht gemischt/)
    expect(validatePlacement(truck, item('b', 'cage', 80, 'cross', 120))).toBeNull()
  })

  it('prüft Kollisionen, Rand und Größenänderungen ohne Randberührung als Kollision zu werten', () => {
    const truck = { ...vehicle(), cargo: [item('a', 'pallet', 0)] }
    expect(validatePlacement(truck, item('b', 'pallet', 0, 'long', 120))).toBeNull()
    expect(validatePlacement(truck, item('b', 'pallet', 0, 'long', 119))).toMatch(/überlappt/)
    expect(validatePlacement(truck, item('b', 'pallet', 170))).toMatch(/innerhalb/)
    expect(validateVehicleCargo({ ...truck, width: 60 })).toMatch(/innerhalb/)
  })
})

describe('Lastverteilung', () => {
  const limits = [
    { id: '1', distance: 0, weight: 200 },
    { id: '2', distance: 200, weight: 400 },
  ]
  it('interpoliert nur innerhalb der erfassten Abstände', () => {
    expect(allowedAt([...limits].reverse(), 100)).toBe(300)
    expect(allowedAt(limits, 0)).toBe(200)
    expect(allowedAt(limits, 201)).toBeNull()
    expect(allowedAt([], 100)).toBeNull()
  })
  it('warnt bei überschrittener Gesamtzuladung, nicht bei Gleichheit oder fehlendem Grenzwert', () => {
    const loaded = { ...vehicle(), cargo: [{ ...item('a', 'pallet', 0), weight: 300 }] }
    expect(analyzeLoad(loaded).payloadExceeded).toBe(false)
    expect(analyzeLoad({ ...loaded, maxPayload: 300 }).payloadExceeded).toBe(false)
    expect(analyzeLoad({ ...loaded, maxPayload: 299 }).payloadExceeded).toBe(true)
  })
  it('summiert volle Gewichte aller Ladungsträger, die einen Querschnitt schneiden', () => {
    const cargo = [{ ...item('a', 'pallet', 0, 'long', 20), weight: 120 },
      { ...item('b', 'pallet', 80, 'long', 80), weight: 240 }]
    expect(sectionWeightAt(cargo, 0)).toBe(0)
    expect(sectionWeightAt(cargo, 20)).toBe(120)
    expect(sectionWeightAt(cargo, 80)).toBe(360)
    expect(sectionWeightAt(cargo, 140)).toBe(240)
    expect(sectionWeightAt(cargo, 200)).toBe(0)
  })
  it('berücksichtigt die tatsächliche Stelllänge gedrehter Gitterboxen', () => {
    const cargo = [{ ...item('a', 'cage', 0, 'cross', 40), weight: 175 }]
    expect(sectionWeightAt(cargo, 40)).toBe(175)
    expect(sectionWeightAt(cargo, 122)).toBe(175)
    expect(sectionWeightAt(cargo, 123)).toBe(0)
  })
  it('zeichnet konstante Querschnittslasten und endet mit der Ladung', () => {
    const truck = { ...vehicle(), cargo: [{ ...item('a', 'pallet', 0), weight: 120 }],
      limits: [{ id: '0', distance: 0, weight: 50 },
        { id: '1', distance: 200, weight: 50 },
        { id: '2', distance: 1360, weight: 200 }] }
    const result = analyzeSections(truck)
    expect(result.segments[0]).toEqual({ start: 0, end: 120, weight: 120 })
    expect(result.segments[1]).toEqual({ start: 120, end: 200, weight: 0 })
    expect(result.exceedingSegments[0]).toEqual({ start: 0, end: 120, weight: 120 })
    expect(result.maxExcess).toBeCloseTo(70)
    expect(result.uncovered).toBe(false)
  })
  it('ermittelt eine Überschreitung auch bei schräger Grenzkurve zwischen Stützstellen', () => {
    const truck = { ...vehicle(), cargo: [{ ...item('a', 'pallet', 0), weight: 120 }],
      limits: [{ id: '0', distance: 0, weight: 80 },
        { id: '1', distance: 200, weight: 180 }] }
    const result = analyzeSections(truck)
    expect(result.exceedingSegments[0]).toEqual({ start: 0, end: 80, weight: 120 })
    expect(result.maxExcess).toBe(40)
    expect(result.uncovered).toBe(false)
  })
  it('meldet nur ungedeckte beladene Bereiche und extrapoliert nicht', () => {
    const truck = { ...vehicle(), cargo: [{ ...item('a', 'pallet', 0, 'long', 300), weight: 120 }],
      limits: [{ id: '0', distance: 350, weight: 100 },
        { id: '1', distance: 600, weight: 100 }] }
    const result = analyzeSections(truck)
    expect(result.uncovered).toBe(true)
    expect(result.exceedingSegments).toEqual([{ start: 350, end: 420, weight: 120 }])
    expect(analyzeSections({ ...truck, cargo: [] }).uncovered).toBe(false)
  })
  it('meldet bei einem Querschnittsgewicht gleich dem Grenzwert keine Überschreitung', () => {
    const truck = { ...vehicle(), cargo: [{ ...item('a', 'pallet', 0), weight: 100 }],
      limits: [{ id: '0', distance: 0, weight: 100 },
        { id: '1', distance: 120, weight: 100 }] }
    expect(analyzeSections(truck).exceedingSegments).toEqual([])
    expect(analyzeSections(truck).uncovered).toBe(false)
  })
})
