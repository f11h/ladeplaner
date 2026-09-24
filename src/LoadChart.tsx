import { useRef, useState } from 'react'
import { analyzeSections } from './calculations'
import { Modal } from './Modal'
import { type LoadedVehicle } from './model'

const LEFT = 58
const RIGHT = 764
const TOP = 24
const BOTTOM = 252

export function LoadChart({ vehicle, unplacedCount }: {
  vehicle: LoadedVehicle
  unplacedCount: number
}) {
  const panelRef = useRef<HTMLElement>(null)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [placeholderHeight, setPlaceholderHeight] = useState(0)

  function openModal() {
    setPlaceholderHeight(panelRef.current?.getBoundingClientRect().height ?? 0)
    setModalOpen(true)
  }

  const sections = analyzeSections(vehicle)
  const points = [...vehicle.limits].sort((a, b) => a.distance - b.distance)
  const maxWeight = Math.max(100, ...points.map(point => point.weight),
    ...sections.segments.map(segment => segment.weight)) * 1.12
  const px = (distance: number) => LEFT + distance / vehicle.length * (RIGHT - LEFT)
  const py = (weight: number) => BOTTOM - weight / maxWeight * (BOTTOM - TOP)
  const path = points.map((point, index) =>
    `${index ? 'L' : 'M'} ${px(point.distance)} ${py(point.weight)}`).join(' ')
  const sectionPath = sections.segments.map((segment, index) =>
    `${index ? ` L ${px(segment.start)} ${py(segment.weight)}` :
      `M ${px(segment.start)} ${py(segment.weight)}`} L ${px(segment.end)} ${py(segment.weight)}`).join('')

  const content = (
    <section ref={panelRef} className={`panel chart-panel ${modalOpen ? 'is-modal' : ''}`}>
      <div className="section-heading">
        <div><p className="eyebrow">SICHERHEIT IM BLICK</p><h2>Lastverteilung</h2></div>
        <div className="chart-actions">
          <span className="metric-pill">{vehicle.cargo.length} verladen</span>
          {!modalOpen && <button ref={openButtonRef} className="secondary-button" type="button"
            aria-haspopup="dialog" onClick={openModal}>↗ Vergrößern</button>}
        </div>
      </div>
      <div className="chart-wrap"
        role={modalOpen ? undefined : 'button'}
        tabIndex={modalOpen ? undefined : 0}
        aria-label={modalOpen ? undefined : 'Lastverteilungsdiagramm vergrößern'}
        onClick={modalOpen ? undefined : openModal}
        onKeyDown={modalOpen ? undefined : event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openModal()
          }
        }}>
        <svg viewBox="0 0 800 290" role="img" aria-label="Lastverteilungsdiagramm mit zulässigem Gewicht und tatsächlichem Querschnittsgewicht entlang der Ladefläche">
          {[0, 0.25, 0.5, 0.75, 1].map(step => (
            <g key={step}>
              <line className="grid-line" x1={LEFT} x2={RIGHT} y1={py(maxWeight * step)} y2={py(maxWeight * step)} />
              <text className="axis-label" x={LEFT - 9} y={py(maxWeight * step) + 4} textAnchor="end">
                {Math.round(maxWeight * step).toLocaleString('de-DE')}
              </text>
              <line className="grid-line" x1={px(vehicle.length * step)} x2={px(vehicle.length * step)} y1={TOP} y2={BOTTOM} />
              <text className="axis-label" x={px(vehicle.length * step)} y={BOTTOM + 19} textAnchor="middle">
                {Math.round(vehicle.length * step)}
              </text>
            </g>
          ))}
          {points.length > 1 && <path className="limit-line" d={path} />}
          {points.map(point => <circle className="limit-dot" key={point.id}
            cx={px(point.distance)} cy={py(point.weight)} r="4">
            <title>{point.distance} cm: {point.weight} kg zulässig</title>
          </circle>)}
          <path className="section-line" d={sectionPath} />
          {sections.exceedingSegments.map((segment, index) =>
            <line className="section-danger" key={index}
              x1={px(segment.start)} y1={py(segment.weight)}
              x2={px(segment.end)} y2={py(segment.weight)}>
              <title>Querschnittsgewicht {segment.weight} kg überschreitet die Grenzkurve zwischen {segment.start.toFixed(1)} und {segment.end.toFixed(1)} cm</title>
            </line>)}
          <text className="axis-title" x="408" y="287" textAnchor="middle">Abstand zur Stirnseite (cm)</text>
          <text className="axis-title" x="13" y="142" textAnchor="middle" transform="rotate(-90 13 142)">Gewicht (kg)</text>
        </svg>
      </div>
      <div className="legend">
        <span><i className="legend-key limit-key" /> Zulässiges Gewicht</span>
        <span><i className="legend-key section-key" /> Tatsächliches Querschnittsgewicht</span>
      </div>
      {unplacedCount > 0 && <p className="notice warning" role="status">
        {unplacedCount} Ladungsträger noch zu verladen; im Diagramm ist nur platzierte Ladung enthalten.
      </p>}
      {vehicle.cargo.length === 0
        ? <p className="notice">Noch keine Ladeeinheiten platziert.</p>
        : <>
          {sections.exceedingSegments.length > 0 && <p className="notice danger" role="alert">
            Das Querschnittsgewicht überschreitet die zulässige Last um bis zu
            {' '}{sections.maxExcess.toFixed(1)} kg (rot markierte Abschnitte).
          </p>}
          {sections.uncovered && <p className="notice warning" role="status">
            Die Grenzkurve deckt nicht alle beladenen Abschnitte ab; außerhalb der
            Stützstellen ist keine Prüfung möglich.
          </p>}
          {!points.length && <p className="notice warning">Trage Stützstellen ein, um die Belastung prüfen zu können.</p>}
          {!sections.exceedingSegments.length && !sections.uncovered && !unplacedCount &&
            <p className="notice success">
            Das Querschnittsgewicht liegt auf allen beladenen Abschnitten innerhalb der Grenzkurve.
          </p>}
        </>}
      <p className="fine-print">
        Die Ist-Kurve summiert in jedem Abstand die vollen Gewichte aller Ladungsträger,
        deren Stellfläche den Querschnitt schneidet. Die zulässige Zuladung für das gesamte
        Fahrzeug wird separat in der Gewichtskachel geprüft. Diese Darstellung ersetzt
        keine Achslast-, Sicherungs- oder Herstellerprüfung.
      </p>
    </section>
  )

  return modalOpen ? <>
    <div className="chart-placeholder" style={{ height: placeholderHeight }} aria-hidden="true" />
    <Modal title="Lastverteilungsdiagramm" onClose={() => setModalOpen(false)}
      returnFocusRef={openButtonRef} className="chart-modal" showTitle={false}>
      {content}
    </Modal>
  </> : content
}
