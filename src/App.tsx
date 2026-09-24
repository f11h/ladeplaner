import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { analyzeLoad, SNAP_DISTANCE_CM, snapPlacement, validatePlacement, validateVehicleCargo } from './calculations'
import { LoadChart } from './LoadChart'
import { Modal } from './Modal'
import { footprint, initialSnapshot, LABELS, newVehicle, rotateCargo, SYMBOLS,
  type Cargo, type CargoKind, type LimitPoint, type LoadPlan, type Orientation,
  type PackList, type PlacedCargo, type Snapshot, type Vehicle } from './model'
import { cargoChangeError, getPlan, loadedVehicle, transferPlan, unloadCargo, withPlan } from './plans'
import { loadSnapshot, parseSnapshot, STORAGE_KEY } from './storage'

const SCALE = 1.15
const CARGO_KINDS: CargoKind[] = ['pallet', 'cage', 'rollcontainer']

interface Drag {
  item: PlacedCargo
  existing: boolean
  startClientX: number
  startClientY: number
  offsetX: number
  offsetY: number
  inside: boolean
}

interface VehicleDraft {
  name: string
  length: string
  width: string
  maxPayload: string
  limits: LimitPoint[]
}

interface CargoDraft {
  id: string
  kind: CargoKind
  name: string
  description: string
  weight: string
  isNew: boolean
}

function LimitRow({ point, onSave, onRemove }: {
  point: LimitPoint
  onSave: (id: string, distance: string, weight: string) => boolean
  onRemove: (id: string) => void
}) {
  const [distance, setDistance] = useState(String(point.distance))
  const [weight, setWeight] = useState(String(point.weight))
  useEffect(() => {
    setDistance(String(point.distance))
    setWeight(String(point.weight))
  }, [point.distance, point.weight])
  const commit = () => {
    if (!onSave(point.id, distance, weight)) {
      setDistance(String(point.distance))
      setWeight(String(point.weight))
    }
  }
  return (
    <div className="limit-row">
      <label><span>Abstand (cm)</span>
        <input aria-label="Abstand zur Stirnseite in cm" type="number" min="0" step="1"
          value={distance} onChange={event => setDistance(event.target.value)} onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          }} />
      </label>
      <label><span>Max. Gewicht (kg)</span>
        <input aria-label="Zulässiges Gewicht in kg" type="number" min="0" step="1"
          value={weight} onChange={event => setWeight(event.target.value)} onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          }} />
      </label>
      <button className="icon-button remove-point" type="button" title="Stützstelle entfernen"
        aria-label={`Stützstelle bei ${point.distance} cm entfernen`} onClick={() => onRemove(point.id)}>×</button>
    </div>
  )
}

export default function App() {
  const [loaded] = useState(loadSnapshot)
  const [snapshot, setSnapshot] = useState<Snapshot>(loaded.snapshot)
  const [storageBlocked, setStorageBlocked] = useState(loaded.error !== null)
  const [message, setMessage] = useState(loaded.error ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [orientation, setOrientation] = useState<Orientation>('long')
  const [armed, setArmed] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const vehicleEditButtonRef = useRef<HTMLButtonElement>(null)
  const cargoEditOpenerRef = useRef<HTMLElement | null>(null)
  const [pendingImport, setPendingImport] = useState<Snapshot | null>(null)
  const [vehicleDraft, setVehicleDraft] = useState<VehicleDraft | null>(null)
  const [vehicleEditorError, setVehicleEditorError] = useState('')
  const [cargoDraft, setCargoDraft] = useState<CargoDraft | null>(null)
  const [cargoEditorError, setCargoEditorError] = useState('')

  const vehicleDefinition = snapshot.vehicles.find(entry => entry.id === snapshot.activeVehicleId)!
  const packList = snapshot.packLists.find(entry => entry.id === snapshot.activePackListId)!
  const plan = getPlan(snapshot)!
  const vehicle = loadedVehicle(vehicleDefinition, packList, plan)
  const unplaced = packList.cargo.filter(item => !plan.placements.some(p => p.cargoId === item.id))
  const [draftListName, setDraftListName] = useState(packList.name)

  useEffect(() => {
    setSelectedId(null)
    setArmed(null)
  }, [vehicle.id, packList.id])

  useEffect(() => {
    setDraftListName(packList.name)
  }, [packList.id, packList.name])

  useEffect(() => {
    if (storageBlocked) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch (error) {
      setStorageBlocked(true)
      setMessage(`Speichern fehlgeschlagen: ${String(error)}. Änderungen sind nur für diese Sitzung verfügbar.`)
    }
  }, [snapshot, storageBlocked])

  function updateVehicle(next: Vehicle) {
    setSnapshot(previous => ({
      ...previous, vehicles: previous.vehicles.map(entry => entry.id === next.id ? next : entry),
    }))
  }

  function updatePackList(next: PackList) {
    setSnapshot(previous => ({
      ...previous, packLists: previous.packLists.map(entry => entry.id === next.id ? next : entry),
    }))
  }

  function updatePlan(next: LoadPlan) {
    setSnapshot(previous => withPlan(previous, next))
  }

  function activate(vehicleId: string, packListId: string) {
    const target = snapshot.vehicles.find(entry => entry.id === vehicleId)!
    const list = snapshot.packLists.find(entry => entry.id === packListId)!
    const existing = getPlan(snapshot, vehicleId, packListId)
    const source = plan.packListId === packListId ? plan :
      snapshot.plans.find(entry => entry.packListId === packListId)
    const transferred = existing ? null : transferPlan(target, list, source)
    const next = transferred ? withPlan(snapshot, transferred.plan) : snapshot
    setSnapshot({ ...next, activeVehicleId: vehicleId, activePackListId: packListId })
    setMessage(transferred?.skipped
      ? `${transferred.skipped} Ladungsträger passen nicht auf das gewählte Fahrzeug und bleiben unverladen.`
      : '')
  }

  function applyCargo(item: PlacedCargo) {
    if (!packList.cargo.some(entry => entry.id === item.id)) {
      setMessage('Der Ladungsträger gehört nicht zur aktiven Packliste.')
      return
    }
    const error = validatePlacement(vehicle, item)
    if (error) { setMessage(error); return }
    const placement = { cargoId: item.id, x: item.x, y: item.y, orientation: item.orientation }
    updatePlan({ ...plan, placements: [...plan.placements.filter(entry => entry.cargoId !== item.id),
      placement] })
    setSelectedId(item.id)
    setArmed(null)
    setMessage('')
  }

  function rotateItem(item: PlacedCargo) {
    applyCargo(rotateCargo(item))
  }

  function stagePoint(clientX: number, clientY: number) {
    const rect = stageRef.current!.getBoundingClientRect()
    return {
      x: (clientY - rect.top) / SCALE,
      y: (clientX - rect.left) / SCALE,
      inside: clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom,
    }
  }

  function draggedItem(current: Drag, clientX: number, clientY: number) {
    const point = stagePoint(clientX, clientY)
    return snapPlacement(vehicle, {
      ...current.item,
      x: Math.round(point.x - current.offsetX),
      y: Math.round(point.y - current.offsetY),
    })
  }

  function startDrag(event: ReactPointerEvent, item: PlacedCargo, existing: boolean) {
    if (event.button !== 0) return
    if (!existing) event.preventDefault()
    event.stopPropagation()
    if (existing) {
      setSelectedId(item.id)
      setArmed(null)
    } else setArmed(item.id)
    const point = stagePoint(event.clientX, event.clientY)
    const size = footprint(item)
    const next: Drag = {
      item, existing, inside: point.inside,
      startClientX: event.clientX, startClientY: event.clientY,
      offsetX: existing ? point.x - item.x : size.length / 2,
      offsetY: existing ? point.y - item.y : size.width / 2,
    }
    if (existing) event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = next
    setDrag(next)
  }

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const current = dragRef.current
      if (!current) return
      const point = stagePoint(event.clientX, event.clientY)
      const next: Drag = {
        ...current, item: draggedItem(current, event.clientX, event.clientY),
        inside: point.inside,
      }
      dragRef.current = next
      setDrag(next)
    }
    function onUp(event: PointerEvent) {
      const current = dragRef.current
      if (!current) return
      const point = stagePoint(event.clientX, event.clientY)
      dragRef.current = null
      setDrag(null)
      if (current.existing && Math.hypot(
        event.clientX - current.startClientX, event.clientY - current.startClientY,
      ) < 3) return
      if (!point.inside) {
        if (current.existing) {
          updatePlan(unloadCargo(plan, current.item.id))
          setSelectedId(current.item.id)
          setMessage('')
        }
        return
      }
      applyCargo(draggedItem(current, event.clientX, event.clientY))
    }
    function onCancel() {
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  })

  function openVehicleEditor() {
    setVehicleDraft({
      name: vehicleDefinition.name,
      length: String(vehicleDefinition.length),
      width: String(vehicleDefinition.width),
      maxPayload: vehicleDefinition.maxPayload === null ? '' : String(vehicleDefinition.maxPayload),
      limits: vehicleDefinition.limits.map(point => ({ ...point })),
    })
    setVehicleEditorError('')
  }

  function updateVehicleDraft(changes: Partial<VehicleDraft>) {
    setVehicleDraft(previous => previous ? { ...previous, ...changes } : null)
  }

  function saveVehicleEditor(event: FormEvent) {
    event.preventDefault()
    if (!vehicleDraft) return
    const length = Number(vehicleDraft.length)
    const width = Number(vehicleDraft.width)
    const maxPayload = vehicleDraft.maxPayload.trim() === '' ? null : Number(vehicleDraft.maxPayload)
    if (!vehicleDraft.name.trim()) {
      setVehicleEditorError('Bitte einen Fahrzeugnamen eingeben.')
      return
    }
    if (!vehicleDraft.length.trim() || !vehicleDraft.width.trim() ||
        !Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(width) || width <= 0) {
      setVehicleEditorError('Länge und Breite müssen positive ganze Zentimeterwerte sein.')
      return
    }
    if (maxPayload !== null && (!Number.isSafeInteger(maxPayload) || maxPayload < 0)) {
      setVehicleEditorError('Die zulässige Zuladung muss eine nichtnegative ganze Kilogrammzahl sein.')
      return
    }
    const next: Vehicle = {
      ...vehicleDefinition, name: vehicleDraft.name.trim(), length, width,
      maxPayload, limits: vehicleDraft.limits,
    }
    if (next.limits.some(point => point.distance > length)) {
      setVehicleEditorError('Eine Stützstelle liegt außerhalb der neuen Fahrzeuglänge.')
      return
    }
    for (const savedPlan of snapshot.plans.filter(entry => entry.vehicleId === vehicle.id)) {
      const list = snapshot.packLists.find(entry => entry.id === savedPlan.packListId)!
      const invalid = validateVehicleCargo(loadedVehicle(next, list, savedPlan))
      if (invalid) {
        setVehicleEditorError(`Maßänderung nicht möglich (${list.name}): ${invalid}`)
        return
      }
    }
    updateVehicle(next)
    setVehicleDraft(null)
    setVehicleEditorError('')
    setMessage('')
  }

  function addVehicle() {
    const name = `LKW ${snapshot.vehicles.length + 1}`
    const next = newVehicle(name)
    const transferred = transferPlan(next, packList, plan)
    setSnapshot({
      ...snapshot, activeVehicleId: next.id, vehicles: [...snapshot.vehicles, next],
      plans: [...snapshot.plans, transferred.plan],
    })
    setMessage(transferred.skipped
      ? `${transferred.skipped} Ladungsträger passen nicht auf das neue Fahrzeug und bleiben unverladen.`
      : '')
  }

  function deleteVehicle() {
    if (snapshot.vehicles.length === 1) {
      setMessage('Das letzte Fahrzeug kann nicht gelöscht werden.')
      return
    }
    if (!window.confirm(`„${vehicle.name}“ und seine Ladepläne löschen? Die Packlisten bleiben erhalten.`)) return
    const vehicles = snapshot.vehicles.filter(entry => entry.id !== vehicle.id)
    const remaining = { ...snapshot, vehicles,
      plans: snapshot.plans.filter(entry => entry.vehicleId !== vehicle.id) }
    const existing = getPlan(remaining, vehicles[0].id, packList.id)
    const transferred = existing ? null : transferPlan(vehicles[0], packList, plan)
    const next = transferred ? withPlan(remaining, transferred.plan) : remaining
    setSnapshot({ ...next, activeVehicleId: vehicles[0].id })
    setMessage('')
  }

  function addPackList() {
    const next: PackList = {
      id: crypto.randomUUID(), name: `Packliste ${snapshot.packLists.length + 1}`, cargo: [],
    }
    setSnapshot({
      ...snapshot, activePackListId: next.id, packLists: [...snapshot.packLists, next],
      plans: [...snapshot.plans, { vehicleId: vehicle.id, packListId: next.id, placements: [] }],
    })
    setMessage('')
  }

  function deletePackList() {
    if (snapshot.packLists.length === 1) {
      setMessage('Die letzte Packliste kann nicht gelöscht werden.')
      return
    }
    if (!window.confirm(`Packliste „${packList.name}“ und ihre Ladepläne löschen?`)) return
    const packLists = snapshot.packLists.filter(entry => entry.id !== packList.id)
    const remaining = { ...snapshot, packLists,
      plans: snapshot.plans.filter(entry => entry.packListId !== packList.id) }
    const nextList = packLists[0]
    const existing = getPlan(remaining, vehicle.id, nextList.id)
    const source = remaining.plans.find(entry => entry.packListId === nextList.id)
    const transferred = existing ? null : transferPlan(vehicleDefinition, nextList, source)
    const next = transferred ? withPlan(remaining, transferred.plan) : remaining
    setSnapshot({ ...next, activePackListId: nextList.id })
    setMessage('')
  }

  function saveListName() {
    if (!draftListName.trim()) {
      setDraftListName(packList.name)
      setMessage('Bitte einen Namen für die Packliste eingeben.')
      return
    }
    updatePackList({ ...packList, name: draftListName.trim() })
    setMessage('')
  }

  function openCargoEditor(item: Cargo | null, kind: CargoKind, opener: HTMLElement) {
    cargoEditOpenerRef.current = opener
    setCargoDraft(item
      ? { ...item, weight: String(item.weight), isNew: false }
      : { id: crypto.randomUUID(), kind, name: LABELS[kind], description: '', weight: '100', isNew: true })
    setCargoEditorError('')
  }

  function updateCargoDraft(changes: Partial<CargoDraft>) {
    setCargoDraft(previous => previous ? { ...previous, ...changes } : null)
  }

  function saveCargoEditor(event: FormEvent) {
    event.preventDefault()
    if (!cargoDraft) return
    const weight = Number(cargoDraft.weight)
    if (!cargoDraft.name.trim()) {
      setCargoEditorError('Bitte einen Namen für das Packstück eingeben.')
      return
    }
    if (!cargoDraft.weight.trim() || !Number.isSafeInteger(weight) || weight < 0) {
      setCargoEditorError('Das Gewicht muss eine nichtnegative ganze Kilogrammzahl sein.')
      return
    }
    const item: Cargo = {
      id: cargoDraft.id, kind: cargoDraft.kind, name: cargoDraft.name.trim(),
      description: cargoDraft.description, weight,
    }
    if (!cargoDraft.isNew) {
      const error = cargoChangeError(snapshot, packList.id, item)
      if (error) {
        setCargoEditorError(`Änderung nicht möglich: ${error}`)
        return
      }
    }
    updatePackList({ ...packList, cargo: cargoDraft.isNew
      ? [...packList.cargo, item]
      : packList.cargo.map(entry => entry.id === item.id ? item : entry) })
    setSelectedId(item.id)
    setArmed(null)
    setCargoDraft(null)
    setCargoEditorError('')
    setMessage('')
  }

  function deleteCargo(id: string): boolean {
    const item = packList.cargo.find(entry => entry.id === id)
    if (!item) {
      setCargoEditorError('Das Packstück ist nicht mehr in der Packliste vorhanden.')
      return false
    }
    if (!window.confirm(`„${item.name}“ aus der Packliste und allen zugehörigen Ladeplänen löschen?`)) {
      return false
    }
    setSnapshot(previous => ({
      ...previous,
      packLists: previous.packLists.map(entry => entry.id === packList.id
        ? { ...entry, cargo: entry.cargo.filter(cargo => cargo.id !== id) } : entry),
      plans: previous.plans.map(entry => entry.packListId === packList.id
        ? { ...entry, placements: entry.placements.filter(placement => placement.cargoId !== id) } : entry),
    }))
    setSelectedId(null)
    setArmed(null)
    setMessage('')
    return true
  }

  function addLimit() {
    if (!vehicleDraft) return
    const length = Number(vehicleDraft.length)
    if (!vehicleDraft.length.trim() || !Number.isSafeInteger(length) || length <= 0) {
      setVehicleEditorError('Bitte zuerst eine gültige Fahrzeuglänge eingeben.')
      return
    }
    const occupied = new Set(vehicleDraft.limits.map(point => point.distance))
    let distance = vehicleDraft.limits.length
      ? Math.min(length, Math.max(...vehicleDraft.limits.map(point => point.distance)) + 100)
      : 0
    while (distance <= length && occupied.has(distance)) distance++
    if (distance > length) {
      distance = 0
      while (distance <= length && occupied.has(distance)) distance++
    }
    if (distance > length) { setVehicleEditorError('Für diese Länge gibt es keine freie Zentimeterposition.'); return }
    const point: LimitPoint = { id: crypto.randomUUID(), distance, weight: 1000 }
    updateVehicleDraft({ limits: [...vehicleDraft.limits, point] })
    setVehicleEditorError('')
  }

  function saveLimit(id: string, rawDistance: string, rawWeight: string): boolean {
    if (!vehicleDraft) return false
    const distance = Number(rawDistance)
    const weight = Number(rawWeight)
    if (!rawDistance.trim() || !rawWeight.trim() || !Number.isSafeInteger(distance) ||
        !Number.isSafeInteger(weight) || distance < 0 ||
        distance > Number(vehicleDraft.length) || weight < 0) {
      setVehicleEditorError('Stützstellen benötigen ganze Werte: Abstand von 0 bis Fahrzeuglänge, Gewicht ab 0 kg.')
      return false
    }
    if (vehicleDraft.limits.some(point => point.id !== id && point.distance === distance)) {
      setVehicleEditorError('Für diesen Abstand existiert bereits eine Stützstelle.')
      return false
    }
    updateVehicleDraft({ limits: vehicleDraft.limits.map(point =>
      point.id === id ? { ...point, distance, weight } : point) })
    setVehicleEditorError('')
    return true
  }

  async function importFile(file: File) {
    setPendingImport(null)
    try {
      const value: unknown = JSON.parse(await file.text())
      const imported = parseSnapshot(value)
      setPendingImport(imported)
      setMessage('')
    } catch (error) {
      if (error instanceof Error) setMessage(`Import fehlgeschlagen: ${error.message}`)
      else throw error
    }
  }

  function exportFile() {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'ladeplaner-konfiguration.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function exportPdf() {
    try {
      const { createDriverPdf } = await import('./pdf')
      createDriverPdf(vehicle, packList).save('ladeplan.pdf')
      setMessage('')
    } catch (error) {
      setMessage(`PDF-Export fehlgeschlagen: ${String(error)}`)
    }
  }

  const ghostError = drag?.inside ? validatePlacement(vehicle, drag.item) : null
  const armedCargo = unplaced.find(item => item.id === armed)
  const load = analyzeLoad(vehicle)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">▦</span>
          <div><strong>LADEPLANER</strong><small>RAUM. GEWICHT. ÜBERBLICK.</small></div>
        </div>
        <div className="header-actions">
          <span className="local-badge">● Lokal gespeichert</span>
          <button className="secondary-button" onClick={() => void exportPdf()}>↓ PDF exportieren</button>
          <button className="secondary-button" onClick={exportFile}>↓ JSON exportieren</button>
          <button className="primary-button" onClick={() => fileRef.current?.click()}>↑ JSON importieren</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
              event.target.value = ''
            }} />
        </div>
      </header>

      <main className="workspace">
        <div className="intro">
          <div><p className="eyebrow">DEIN DIGITALER BELADUNGSPLAN</p>
            <h1>Jeder Zentimeter zählt.</h1>
            <p>Plane die Ladefläche von oben, prüfe Stellplätze und behalte die Lastverteilung im Blick.</p>
          </div>
          <div className="summary-chip"><strong>{vehicle.cargo.length}/{packList.cargo.length}</strong>
            <span>Ladungsträger<br />verladen</span></div>
        </div>

        {message && <div className="global-alert" role="alert">{message}</div>}
        {storageBlocked && <div className="storage-recovery">
          <p>Der lokale Speicher wurde nicht überschrieben. Du kannst eine gültige Datei importieren oder mit einer neuen Konfiguration beginnen.</p>
          <button className="secondary-button" onClick={() => {
            setSnapshot(initialSnapshot())
            setStorageBlocked(false)
            setMessage('')
          }}>Mit leerer Konfiguration neu beginnen</button>
        </div>}
        {pendingImport && <div className="import-banner" role="status">
          <span><strong>{pendingImport.vehicles.length} Fahrzeuge und {pendingImport.packLists.length} Packlisten importbereit.</strong> Beim Übernehmen wird der aktuelle Bestand ersetzt. Exportiere ihn vorher bei Bedarf.</span>
          <div className="inline-actions">
            <button className="secondary-button" onClick={() => setPendingImport(null)}>Abbrechen</button>
            <button className="primary-button" onClick={() => {
              if (!window.confirm('Aktuelle Fahrzeuge durch die importierte Konfiguration ersetzen?')) return
              setSnapshot(pendingImport)
              setPendingImport(null)
              setStorageBlocked(false)
              setMessage('')
            }}>Bestand ersetzen</button>
          </div>
        </div>}

        <div className="layout">
          <aside className="side-column">
            <section className="panel">
              <p className="eyebrow">01 / PACKLISTE</p><h2>Ladung vorbereiten</h2>
              <label className="field-label">Aktive Packliste
                <select value={packList.id} onChange={event => activate(vehicle.id, event.target.value)}>
                  {snapshot.packLists.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <label className="field-label">Bezeichnung
                <input value={draftListName} onChange={event => setDraftListName(event.target.value)}
                  onBlur={saveListName} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
              </label>
              <div className="inline-actions vehicle-actions">
                <button className="text-button" onClick={addPackList}>+ Packliste anlegen</button>
                <button className="text-button danger-text" onClick={deletePackList}>Löschen</button>
              </div>
              <p className="helper">Zuerst Ladungsträger hinzufügen, dann auf dem gewählten Fahrzeug platzieren.</p>
              <div className="inline-actions">
                <button className="secondary-button" onClick={event =>
                  openCargoEditor(null, 'pallet', event.currentTarget)}>+ Europalette</button>
                <button className="secondary-button" onClick={event =>
                  openCargoEditor(null, 'cage', event.currentTarget)}>+ Gitterbox</button>
                <button className="secondary-button" onClick={event =>
                  openCargoEditor(null, 'rollcontainer', event.currentTarget)}>+ Rollcontainer</button>
              </div>
              <p className="field-label placement-label">Ausrichtung beim Verladen</p>
              <div className="segmented" role="group" aria-label="Ausrichtung neuer Ladeeinheiten">
                <button className={orientation === 'long' ? 'active' : ''} onClick={() => setOrientation('long')}>Längs</button>
                <button className={orientation === 'cross' ? 'active' : ''} onClick={() => setOrientation('cross')}>Quer</button>
              </div>
              <p className="helper">Unverladene Einheiten auf die Fläche ziehen oder auswählen und dort antippen. Kanten und Mittelpunkte rasten bis {SNAP_DISTANCE_CM} cm Abstand ein.</p>
              {packList.cargo.length === 0 && <p className="empty-state">Die Packliste ist noch leer.</p>}
              <div className="packlist-items">
                {packList.cargo.map(item => {
                  const placed = vehicle.cargo.find(entry => entry.id === item.id)
                  return <div className="cargo-row" key={item.id}>
                    <button className={`cargo-tool ${selectedId === item.id ? 'armed' : ''}`}
                      onPointerDown={event => {
                        if (!placed) startDrag(event, { ...item, x: 0, y: 0, orientation }, false)
                      }}
                      onClick={() => {
                        setSelectedId(item.id)
                        setArmed(placed ? null : item.id)
                      }}>
                      <span className={`tool-icon ${item.kind}`} aria-hidden="true">
                        {SYMBOLS[item.kind]}
                      </span>
                      <span className="packlist-item-text"><strong>{item.name}</strong>
                        <small>{item.weight} kg · {placed ? 'verladen' : 'noch zu verladen'}</small></span>
                      <span className={`cargo-status ${placed ? 'loaded' : ''}`}>{placed ? '✓' : '+'}</span>
                    </button>
                    <button className="cargo-edit-button" type="button" title={`${item.name} bearbeiten`}
                      aria-label={`${item.name} bearbeiten`}
                      onClick={event => openCargoEditor(item, item.kind, event.currentTarget)}>✎</button>
                  </div>
                })}
              </div>
              <p className="helper">{unplaced.length} noch zu verladen ·
                {` ${packList.cargo.reduce((sum, item) => sum + item.weight, 0).toLocaleString('de-DE')} kg`} auf der Packliste</p>
            </section>
            <section className="panel">
              <p className="eyebrow">02 / FAHRZEUG</p><h2>Ladefläche</h2>
              <label className="field-label">Aktives Fahrzeug
                <select value={vehicle.id} onChange={event => activate(event.target.value, packList.id)}>
                  {snapshot.vehicles.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <p className="helper">{vehicle.length} × {vehicle.width} cm · Zuladung:
                {' '}{vehicle.maxPayload === null
                  ? 'nicht hinterlegt' : `${vehicle.maxPayload.toLocaleString('de-DE')} kg`}</p>
              <button ref={vehicleEditButtonRef} className="secondary-button full-width" type="button"
                onClick={openVehicleEditor}>Fahrzeug bearbeiten</button>
              <div className="inline-actions vehicle-actions">
                <button className="text-button" onClick={addVehicle}>+ Fahrzeug anlegen</button>
                <button className="text-button danger-text" onClick={deleteVehicle}>Löschen</button>
              </div>
              <p className="helper">Maßstabsgerechte Draufsicht · Stirnseite oben</p>
            </section>

          </aside>

          <section className="panel board-panel">
            <div className="section-heading">
              <div><p className="eyebrow">DRAUFSICHT / MAßSTAB 1 PX ≈ 0,87 CM</p>
                <h2>Deine Ladefläche</h2></div>
              <span className="dimension-pill">{vehicle.width} × {vehicle.length} cm</span>
            </div>
            <div className="board-help">
              <span className="front-marker">▲ STIRNSEITE / FAHRERHAUS</span>
              <span>← Breite {vehicle.width} cm →</span>
            </div>
            <div className="board-scroll">
              <div className="board-surround">
                <div ref={stageRef} className={`stage ${armedCargo ? 'placement-active' : ''}`}
                  style={{ width: vehicle.width * SCALE, height: vehicle.length * SCALE }}
                  onClick={event => {
                    if (!armedCargo || event.target !== event.currentTarget) return
                    const point = stagePoint(event.clientX, event.clientY)
                    const size = footprint({ kind: armedCargo.kind, orientation })
                    const item: PlacedCargo = { ...armedCargo, orientation,
                      x: Math.round(point.x - size.length / 2),
                      y: Math.round(point.y - size.width / 2) }
                    applyCargo(snapPlacement(vehicle, item))
                  }}>
                  {vehicle.cargo.map(item => {
                    const size = footprint(item)
                    return <div className={`placed-item ${item.kind} ${selectedId === item.id ? 'selected' : ''}`}
                      key={item.id}
                      style={{ top: item.x * SCALE, left: item.y * SCALE,
                        width: size.width * SCALE, height: size.length * SCALE }}
                      role="button" tabIndex={0}
                      aria-label={`${item.name}, ${item.weight} kg, ${item.x} cm ab Stirnseite`}
                      title={`${item.name}${item.description ? ` – ${item.description}` : ''}\nDoppelklick zum Drehen`}
                      onPointerDown={event => startDrag(event, item, true)}
                      onClick={event => { event.stopPropagation(); setSelectedId(item.id) }}
                      onDoubleClick={event => {
                        event.preventDefault()
                        event.stopPropagation()
                        rotateItem(item)
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedId(item.id)
                        }
                      }}>
                      <span className="item-symbol">{SYMBOLS[item.kind]}</span>
                      <span className="item-name">{item.name}</span>
                      <span className="item-weight">{item.weight} kg</span>
                    </div>
                  })}
                  {drag?.inside && (() => {
                    const size = footprint(drag.item)
                    return <div className={`drag-ghost ${ghostError ? 'invalid' : 'valid'}`}
                      style={{ top: drag.item.x * SCALE, left: drag.item.y * SCALE,
                        width: size.width * SCALE, height: size.length * SCALE }}>
                      {ghostError ? '✕' : '✓'}
                    </div>
                  })()}
                </div>
              </div>
            </div>
            <div className="board-footer">
              <span><i className="selection-dot pallet" /> Europalette 80 × 120 cm</span>
              <span><i className="selection-dot cage" /> Euro-Gitterbox 83 × 123 cm</span>
              <span><i className="selection-dot rollcontainer" /> Rollcontainer 80 × 120 cm</span>
            </div>
            <p className="fine-print">Zum Entladen einen Ladungsträger aus der Ladefläche hinausziehen.
              Ohne Raster: Einheiten rasten an Wänden, Ladungskanten und mittig in passende Zwischenräume ein.
              {` ${unplaced.length} Ladungsträger noch zu verladen.`}
              Übrige Lücken gelten nicht automatisch als formschlüssig gesichert.</p>
          </section>

          <aside className="side-column right-column">
            <div className={`weight-card ${load.payloadExceeded ? 'overloaded' : ''}`}>
              <span>VERLADENES GEWICHT</span>
              <strong>{load.total.toLocaleString('de-DE')} <small>kg</small></strong>
              <p>{vehicle.cargo.length} von {packList.cargo.length} Ladungsträgern · {unplaced.length} noch zu verladen</p>
              {load.payloadExceeded && vehicle.maxPayload !== null
                ? <p className="payload-warning" role="alert">⚠ Zulässige Zuladung um
                  {' '}{(load.total - vehicle.maxPayload).toLocaleString('de-DE')} kg überschritten
                  {' '}(max. {vehicle.maxPayload.toLocaleString('de-DE')} kg).
                </p>
                : <p className="payload-caption">Zulässige Zuladung:
                  {' '}{vehicle.maxPayload === null
                    ? 'nicht hinterlegt' : `${vehicle.maxPayload.toLocaleString('de-DE')} kg`}
                </p>}
            </div>
            <LoadChart vehicle={vehicle} unplacedCount={unplaced.length} />
          </aside>
        </div>
      </main>
      {cargoDraft && <Modal title={cargoDraft.isNew ? 'Packstück hinzufügen' : 'Packstück bearbeiten'}
        onClose={() => setCargoDraft(null)} className="cargo-modal"
        returnFocusRef={cargoEditOpenerRef}>
        <form onSubmit={saveCargoEditor} noValidate>
          <label className="field-label">Typ
            <select value={cargoDraft.kind} onChange={event => {
              const kind = CARGO_KINDS.find(value => value === event.target.value)
              if (kind) updateCargoDraft({ kind })
              else setCargoEditorError('Unbekannter Packstücktyp.')
            }}>
              {CARGO_KINDS.map(kind =>
                <option key={kind} value={kind}>{LABELS[kind]}</option>)}
            </select>
          </label>
          <p className="helper">Maße: {cargoDraft.kind === 'cage' ? '83 × 123 cm' : '80 × 120 cm'}.
            Änderungen am Typ werden nur gespeichert, wenn alle bestehenden Ladepläne gültig bleiben.</p>
          <label className="field-label">Name
            <input value={cargoDraft.name} onChange={event =>
              updateCargoDraft({ name: event.target.value })} />
          </label>
          <label className="field-label">Beschreibung
            <textarea rows={3} value={cargoDraft.description}
              placeholder="Inhalt oder Hinweise zur Ladung"
              onChange={event => updateCargoDraft({ description: event.target.value })} />
          </label>
          <label className="field-label">Gewicht <span>kg</span>
            <input type="number" min="0" step="1" value={cargoDraft.weight}
              onChange={event => updateCargoDraft({ weight: event.target.value })} />
          </label>
          {!cargoDraft.isNew && (() => {
            const placed = vehicle.cargo.find(item => item.id === cargoDraft.id)
            return <div className="cargo-modal-tools">
              <p className="helper">{placed
                ? `Position: ${placed.x} cm ab Stirnseite, ${placed.y} cm ab linker Kante`
                : 'Noch nicht auf diesem Fahrzeug verladen.'}</p>
              <div className="inline-actions">
                {placed && <>
                  <button className="secondary-button" type="button" onClick={() => rotateItem(placed)}>
                    ↻ 90° drehen
                  </button>
                  <button className="secondary-button" type="button" onClick={() => {
                    updatePlan(unloadCargo(plan, cargoDraft.id))
                    setMessage('')
                  }}>Entladen</button>
                </>}
                <button className="secondary-button danger-text" type="button"
                  onClick={() => { if (deleteCargo(cargoDraft.id)) setCargoDraft(null) }}>
                  Aus Packliste löschen
                </button>
              </div>
            </div>
          })()}
          {cargoEditorError && <p className="notice danger" role="alert">{cargoEditorError}</p>}
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => setCargoDraft(null)}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit">Packstück speichern</button>
          </div>
        </form>
      </Modal>}
      {vehicleDraft && <Modal title="Fahrzeug bearbeiten" onClose={() => setVehicleDraft(null)}
        className="vehicle-modal" returnFocusRef={vehicleEditButtonRef}>
        <form onSubmit={saveVehicleEditor} noValidate>
          <label className="field-label">Bezeichnung
            <input value={vehicleDraft.name} onChange={event => updateVehicleDraft({ name: event.target.value })} />
          </label>
          <div className="two-fields">
            <label className="field-label">Länge <span>cm</span>
              <input type="number" min="1" step="1" value={vehicleDraft.length}
                onChange={event => updateVehicleDraft({ length: event.target.value })} />
            </label>
            <label className="field-label">Breite <span>cm</span>
              <input type="number" min="1" step="1" value={vehicleDraft.width}
                onChange={event => updateVehicleDraft({ width: event.target.value })} />
            </label>
          </div>
          <label className="field-label">Zulässige Zuladung <span>kg</span>
            <input type="number" min="0" step="1" value={vehicleDraft.maxPayload}
              placeholder="Nicht hinterlegt"
              onChange={event => updateVehicleDraft({ maxPayload: event.target.value })} />
          </label>
          <div className="vehicle-modal-section">
            <p className="eyebrow">LASTVERTEILUNGSPLAN</p>
            <h3>Stützstellen</h3>
            <p className="helper">Abstand zur Stirnseite und zulässiges Gewicht für den
              Querschnitt an dieser Stelle. Zwischen den Stützstellen wird linear interpoliert.</p>
            {vehicleDraft.limits.length === 0 && <p className="empty-state">Noch keine Stützstellen eingetragen.</p>}
            <div className="limits-list">
              {[...vehicleDraft.limits].sort((a, b) => a.distance - b.distance).map(point =>
                <LimitRow key={point.id} point={point} onSave={saveLimit} onRemove={id => {
                  updateVehicleDraft({ limits: vehicleDraft.limits.filter(entry => entry.id !== id) })
                  setVehicleEditorError('')
                }} />)}
            </div>
            <button className="secondary-button" type="button" onClick={addLimit}>
              + Stützstelle hinzufügen
            </button>
          </div>
          {vehicleEditorError && <p className="notice danger" role="alert">{vehicleEditorError}</p>}
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => setVehicleDraft(null)}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit">Fahrzeug speichern</button>
          </div>
        </form>
      </Modal>}
    </div>
  )
}
