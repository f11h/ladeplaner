import { footprint, LABELS, type LimitPoint, type LoadedVehicle, type PlacedCargo } from './model'

const EPSILON = 1e-9
export const SNAP_DISTANCE_CM = 8

export function validatePlacement(vehicle: LoadedVehicle, candidate: PlacedCargo): string | null {
  const { length, width } = footprint(candidate)
  if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.y) ||
      candidate.x < 0 || candidate.y < 0 ||
      candidate.x + length > vehicle.length || candidate.y + width > vehicle.width) {
    return 'Die Ladeeinheit muss vollständig innerhalb der Ladefläche liegen.'
  }

  const cargo = vehicle.cargo.filter(item => item.id !== candidate.id)
  for (const item of cargo) {
    const size = footprint(item)
    if (candidate.x < item.x + size.length && candidate.x + length > item.x &&
        candidate.y < item.y + size.width && candidate.y + width > item.y) {
      return 'Die Ladeeinheit überlappt eine bereits platzierte Einheit.'
    }
  }

  const all = [...cargo, candidate]
  const cuts = [...new Set(all.flatMap(item => [item.x, item.x + footprint(item).length]))].sort((a, b) => a - b)
  for (let i = 0; i < cuts.length - 1; i++) {
    const middle = (cuts[i] + cuts[i + 1]) / 2
    const row = all.filter(item => item.x < middle && item.x + footprint(item).length > middle)
    if (row.some(item => item.orientation !== row[0].orientation)) {
      return 'In einer Querreihe dürfen längs und quer gestellte Einheiten nicht gemischt werden.'
    }
    const cages = row.filter(item => item.kind === 'cage').length
    if (row[0]?.orientation === 'long' && (row.length > 3 || cages > 2)) {
      return 'Längs sind je Querreihe höchstens 3 Einheiten erlaubt, davon maximal 2 Gitterboxen.'
    }
    if (row[0]?.orientation === 'cross' && (row.length > 2 || cages > 1)) {
      return 'Quer sind je Querreihe höchstens 2 Einheiten erlaubt, davon maximal 1 Gitterbox.'
    }
  }
  return null
}

export function validateVehicleCargo(vehicle: LoadedVehicle): string | null {
  for (const item of vehicle.cargo) {
    const error = validatePlacement(vehicle, item)
    if (error) return `${LABELS[item.kind]}: ${error}`
  }
  return null
}

export function snapPlacement(vehicle: LoadedVehicle, candidate: PlacedCargo): PlacedCargo {
  const size = footprint(candidate)
  const xAnchors = [0, vehicle.length - size.length]
  const yAnchors = [0, vehicle.width - size.width]
  const xCenters = new Set<number>()
  const yCenters = new Set<number>()
  const others = vehicle.cargo.filter(item => item.id !== candidate.id)
  for (const item of others) {
    const other = footprint(item)
    xAnchors.push(item.x, item.x + other.length - size.length,
      item.x + other.length, item.x - size.length)
    yAnchors.push(item.y, item.y + other.width - size.width,
      item.y + other.width, item.y - size.width)
  }
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const first = others[i]
      const second = others[j]
      const firstSize = footprint(first)
      const secondSize = footprint(second)
      const sharedYStart = Math.max(first.y, second.y)
      const sharedYEnd = Math.min(first.y + firstSize.width, second.y + secondSize.width)
      if (sharedYStart < sharedYEnd &&
          candidate.y < sharedYEnd && candidate.y + size.width > sharedYStart) {
        const [front, back] = first.x <= second.x ? [first, second] : [second, first]
        const gapStart = front.x + footprint(front).length
        if (back.x - gapStart >= size.length) {
          const center = Math.round((gapStart + back.x - size.length) / 2)
          xAnchors.push(center)
          xCenters.add(center)
        }
      }
      const sharedXStart = Math.max(first.x, second.x)
      const sharedXEnd = Math.min(first.x + firstSize.length, second.x + secondSize.length)
      if (sharedXStart < sharedXEnd &&
          candidate.x < sharedXEnd && candidate.x + size.length > sharedXStart) {
        const [left, right] = first.y <= second.y ? [first, second] : [second, first]
        const gapStart = left.y + footprint(left).width
        if (right.y - gapStart >= size.width) {
          const center = Math.round((gapStart + right.y - size.width) / 2)
          yAnchors.push(center)
          yCenters.add(center)
        }
      }
    }
  }
  const near = (value: number, anchors: number[]) =>
    [...new Set(anchors.filter(anchor => Math.abs(anchor - value) <= SNAP_DISTANCE_CM))]
  const positions = [
    ...near(candidate.x, xAnchors).flatMap(x => near(candidate.y, yAnchors).map(y => ({ x, y }))),
    ...near(candidate.x, xAnchors).map(x => ({ x, y: candidate.y })),
    ...near(candidate.y, yAnchors).map(y => ({ x: candidate.x, y })),
  ]
  const valid = positions
    .filter(({ x, y }) => (x !== candidate.x || y !== candidate.y) &&
      validatePlacement(vehicle, { ...candidate, x, y }) === null)
    .sort((a, b) => {
      const axes = (position: { x: number; y: number }) =>
        Number(position.x !== candidate.x) + Number(position.y !== candidate.y)
      const centers = (position: { x: number; y: number }) =>
        Number(position.x !== candidate.x && xCenters.has(position.x)) +
        Number(position.y !== candidate.y && yCenters.has(position.y))
      return axes(b) - axes(a) ||
        centers(b) - centers(a) ||
        (a.x - candidate.x) ** 2 + (a.y - candidate.y) ** 2 -
        ((b.x - candidate.x) ** 2 + (b.y - candidate.y) ** 2)
    })
  return valid.length ? { ...candidate, ...valid[0] } : candidate
}

export function allowedAt(points: LimitPoint[], distance: number): number | null {
  const sorted = [...points].sort((a, b) => a.distance - b.distance)
  const exact = sorted.find(point => Math.abs(point.distance - distance) < EPSILON)
  if (exact) return exact.weight
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]
    const next = sorted[i]
    if (previous.distance < distance && distance < next.distance) {
      return previous.weight + (next.weight - previous.weight) *
        (distance - previous.distance) / (next.distance - previous.distance)
    }
  }
  return null
}

export function analyzeLoad(vehicle: LoadedVehicle) {
  const total = vehicle.cargo.reduce((sum, item) => sum + item.weight, 0)
  return { total, payloadExceeded: vehicle.maxPayload !== null && total > vehicle.maxPayload }
}

export function sectionWeightAt(cargo: PlacedCargo[], distance: number): number {
  return cargo.reduce((sum, item) =>
    sum + (item.x <= distance && distance < item.x + footprint(item).length ? item.weight : 0), 0)
}

export function analyzeSections(vehicle: LoadedVehicle) {
  const limits = [...vehicle.limits].sort((a, b) => a.distance - b.distance)
  const distances = [...new Set([0, vehicle.length,
    ...vehicle.cargo.flatMap(item => [item.x, item.x + footprint(item).length]),
    ...limits.map(point => point.distance)])].sort((a, b) => a - b)
  const segments = distances.slice(0, -1).map((start, index) => ({
    start, end: distances[index + 1],
    weight: sectionWeightAt(vehicle.cargo, (start + distances[index + 1]) / 2),
  }))
  const exceedingSegments: { start: number; end: number; weight: number }[] = []
  let maxExcess = 0
  let uncovered = false
  for (const segment of segments) {
    if (segment.weight === 0) continue
    const beforeLimit = allowedAt(limits, segment.start)
    const afterLimit = allowedAt(limits, segment.end)
    if (beforeLimit === null || afterLimit === null) {
      uncovered = true
      continue
    }
    const beforeExcess = segment.weight - beforeLimit
    const afterExcess = segment.weight - afterLimit
    maxExcess = Math.max(maxExcess, beforeExcess, afterExcess)
    if (beforeExcess <= EPSILON && afterExcess <= EPSILON) continue
    const crossing = beforeExcess > EPSILON && afterExcess > EPSILON
      ? segment.start
      : segment.start + (segment.end - segment.start) *
        (-beforeExcess) / (afterExcess - beforeExcess)
    const start = beforeExcess > EPSILON ? segment.start : crossing
    const end = afterExcess > EPSILON ? segment.end : crossing
    if (end - start > EPSILON) exceedingSegments.push({ start, end, weight: segment.weight })
  }
  return { segments, exceedingSegments, maxExcess, uncovered }
}
