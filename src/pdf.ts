import { jsPDF } from 'jspdf'
import { analyzeLoad, analyzeSections } from './calculations'
import { footprint, LABELS, type Cargo, type LoadedVehicle, type PackList } from './model'

const PAGE_WIDTH = 210
const MARGIN = 12
const BOTTOM = 274

function text(pdf: jsPDF, value: string, x: number, y: number, size = 9, bold = false) {
  pdf.setFont('helvetica', bold ? 'bold' : 'normal')
  pdf.setFontSize(size)
  pdf.setTextColor(28, 45, 51)
  pdf.text(value, x, y)
}

function shortText(pdf: jsPDF, value: string, maxWidth: number): string {
  if (pdf.getTextWidth(value) <= maxWidth) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (pdf.getTextWidth(`${value.slice(0, middle)}...`) <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${value.slice(0, low)}...`
}

function cargoColor(kind: Cargo['kind']): [number, number, number] {
  if (kind === 'cage') return [171, 201, 221]
  if (kind === 'rollcontainer') return [240, 203, 156]
  return [174, 214, 175]
}

function drawPlan(pdf: jsPDF, vehicle: LoadedVehicle, packList: PackList) {
  const placed = new Map(vehicle.cargo.map(item => [item.id, item]))
  const { total, payloadExceeded } = analyzeLoad(vehicle)
  const sections = analyzeSections(vehicle)
  text(pdf, 'LADEPLAN', MARGIN, 17, 20, true)
  pdf.setFontSize(10)
  text(pdf, shortText(pdf, `${vehicle.name}  |  ${packList.name}`, 186), MARGIN, 26, 10)
  text(pdf, `${vehicle.width} x ${vehicle.length} cm  |  ${vehicle.cargo.length}/${packList.cargo.length} verladen  |  ${total.toLocaleString('de-DE')} kg`, MARGIN, 33, 8)
  let warningLines: string[] = []
  if (payloadExceeded || sections.exceedingSegments.length || sections.uncovered ||
      placed.size !== packList.cargo.length) {
    const warnings = [
      payloadExceeded ? 'Zuladung ueberschritten' : '',
      sections.exceedingSegments.length ? 'Querschnittslast ueberschritten' : '',
      sections.uncovered ? 'Grenzkurve unvollstaendig' : '',
      placed.size !== packList.cargo.length ? 'Packstuecke offen' : '',
    ].filter(Boolean)
    pdf.setTextColor(173, 59, 48)
    pdf.setFontSize(8)
    warningLines = pdf.splitTextToSize(`ACHTUNG: ${warnings.join(' | ')}`, 186) as string[]
    warningLines.forEach((line, index) => pdf.text(line, MARGIN, 39 + index * 4))
  }

  const boardTop = Math.max(47, 43 + warningLines.length * 4)
  const scale = Math.min((260 - boardTop) / vehicle.length, 112 / vehicle.width)
  const boardWidth = vehicle.width * scale
  const boardHeight = vehicle.length * scale
  const boardLeft = MARGIN + (112 - boardWidth) / 2
  text(pdf, 'STIRNSEITE / FAHRERHAUS', boardLeft, boardTop - 3, 7, true)
  pdf.setFillColor(239, 245, 238)
  pdf.setDrawColor(87, 113, 100)
  pdf.setLineWidth(0.6)
  pdf.rect(boardLeft, boardTop, boardWidth, boardHeight, 'FD')
  for (const [index, item] of packList.cargo.entries()) {
    const position = placed.get(item.id)
    if (!position) continue
    const dimensions = footprint(position)
    const x = boardLeft + position.y * scale
    const y = boardTop + position.x * scale
    const width = dimensions.width * scale
    const height = dimensions.length * scale
    pdf.setFillColor(...cargoColor(item.kind))
    pdf.setDrawColor(63, 89, 79)
    pdf.setLineWidth(0.35)
    pdf.rect(x, y, width, height, 'FD')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(Math.min(8, Math.max(3, width * 0.8)))
    pdf.setTextColor(29, 55, 43)
    pdf.text(String(index + 1), x + width / 2, y + height / 2 + 1,
      { align: 'center' })
  }

  const legendX = 133
  text(pdf, 'PACKSTUECKE IM PLAN', legendX, 48, 9, true)
  text(pdf, 'Nummer = Packlistenposition', legendX, 54, 7)
  let legendY = 62
  for (const [index, item] of packList.cargo.entries()) {
    if (legendY > 247) break
    const position = placed.get(item.id)
    text(pdf, `${index + 1}.`, legendX, legendY, 8, true)
    pdf.setFontSize(8)
    text(pdf, shortText(pdf, item.name, 53), legendX + 8, legendY, 8)
    text(pdf, position
      ? `${LABELS[item.kind]} · ${item.weight} kg`
      : `${LABELS[item.kind]} · OFFEN`, legendX + 8, legendY + 4, 6.5)
    legendY += 9
  }
  if (packList.cargo.length > Math.floor((247 - 62) / 9) + 1) {
    text(pdf, 'Weitere: siehe Packliste', legendX, 256, 7, true)
  }
  text(pdf, 'Stirnseite oben · Grundriss massstabsgetreu · Details und Lastverteilung auf Seite 2', MARGIN, 269, 7)
}

function drawChart(pdf: jsPDF, vehicle: LoadedVehicle) {
  const result = analyzeSections(vehicle)
  const limits = [...vehicle.limits].sort((a, b) => a.distance - b.distance)
  const left = 31
  const right = 195
  const top = 45
  const bottom = 103
  const maxWeight = Math.max(100, ...limits.map(point => point.weight),
    ...result.segments.map(segment => segment.weight)) * 1.12
  const px = (distance: number) => left + distance / vehicle.length * (right - left)
  const py = (weight: number) => bottom - weight / maxWeight * (bottom - top)

  text(pdf, 'LASTVERTEILUNG', MARGIN, 38, 11, true)
  for (let step = 0; step <= 4; step++) {
    const ratio = step / 4
    pdf.setDrawColor(222, 230, 225)
    pdf.setLineWidth(0.2)
    pdf.line(left, py(maxWeight * ratio), right, py(maxWeight * ratio))
    pdf.line(px(vehicle.length * ratio), top, px(vehicle.length * ratio), bottom)
    text(pdf, String(Math.round(maxWeight * ratio)), MARGIN, py(maxWeight * ratio) + 1, 6.5)
    text(pdf, String(Math.round(vehicle.length * ratio)), px(vehicle.length * ratio) - 4, bottom + 5, 6.5)
  }
  pdf.setDrawColor(57, 142, 112)
  pdf.setLineWidth(0.7)
  for (let i = 1; i < limits.length; i++) {
    pdf.line(px(limits[i - 1].distance), py(limits[i - 1].weight),
      px(limits[i].distance), py(limits[i].weight))
  }
  for (const point of limits) {
    pdf.setFillColor(57, 142, 112)
    pdf.circle(px(point.distance), py(point.weight), 0.8, 'F')
  }
  pdf.setDrawColor(174, 116, 55)
  pdf.setLineWidth(0.6)
  result.segments.forEach((segment, index) => {
    if (index) {
      pdf.line(px(segment.start), py(result.segments[index - 1].weight),
        px(segment.start), py(segment.weight))
    }
    pdf.line(px(segment.start), py(segment.weight), px(segment.end), py(segment.weight))
  })
  pdf.setDrawColor(211, 94, 85)
  pdf.setLineWidth(1.2)
  for (const segment of result.exceedingSegments) {
    pdf.line(px(segment.start), py(segment.weight), px(segment.end), py(segment.weight))
  }
  text(pdf, 'Abstand zur Stirnseite (cm)', 80, 114, 7)
  pdf.setDrawColor(57, 142, 112)
  pdf.setLineWidth(0.8)
  pdf.line(MARGIN, 120, MARGIN + 5, 120)
  text(pdf, 'Zulaessig', MARGIN + 7, 121, 7)
  pdf.setDrawColor(174, 116, 55)
  pdf.line(65, 120, 70, 120)
  text(pdf, 'Ist-Querschnittsgewicht', 72, 121, 7)
  if (!limits.length || result.uncovered || result.exceedingSegments.length) {
    const warning = !limits.length ? 'Keine Grenzkurve hinterlegt'
      : result.exceedingSegments.length ? 'Grenzwert ueberschritten (rot)'
        : 'Beladene Bereiche ohne Grenzwert'
    pdf.setTextColor(173, 59, 48)
    pdf.setFontSize(7)
    pdf.text(warning, MARGIN, 128)
  } else {
    text(pdf, 'Volles Gewicht jedes Packstuecks ueber seiner gesamten Laenge.', MARGIN, 128, 7)
  }
}

function drawTableHeading(pdf: jsPDF, y: number) {
  pdf.setFillColor(233, 242, 236)
  pdf.rect(MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 8, 'F')
  text(pdf, 'Nr.', 14, y + 5, 8, true)
  text(pdf, 'Typ', 24, y + 5, 8, true)
  text(pdf, 'Name / Beschreibung', 63, y + 5, 8, true)
  text(pdf, 'kg', 151, y + 5, 8, true)
  text(pdf, 'Position', 167, y + 5, 8, true)
}

function drawPackList(pdf: jsPDF, vehicle: LoadedVehicle, packList: PackList) {
  const placed = new Map(vehicle.cargo.map(item => [item.id, item]))
  text(pdf, 'PACKLISTE', MARGIN, 17, 18, true)
  pdf.setFontSize(9)
  text(pdf, shortText(pdf, `${vehicle.name}  |  ${packList.name}`, 186), MARGIN, 25, 9)
  drawChart(pdf, vehicle)
  drawTableHeading(pdf, 135)
  let y = 143

  for (const [index, item] of packList.cargo.entries()) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    const nameLines = pdf.splitTextToSize(item.name, 83) as string[]
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    const descriptionLines = item.description
      ? pdf.splitTextToSize(item.description, 83) as string[]
      : []
    const lines = [
      ...nameLines.map(value => ({ value, bold: true })),
      ...descriptionLines.map(value => ({ value, bold: false })),
    ]
    let first = true
    while (lines.length) {
      if (y > BOTTOM - 11) {
        pdf.addPage()
        text(pdf, 'PACKLISTE (FORTSETZUNG)', MARGIN, 17, 16, true)
        pdf.setFontSize(9)
        text(pdf, shortText(pdf, `${vehicle.name}  |  ${packList.name}`, 186), MARGIN, 25, 9)
        drawTableHeading(pdf, 32)
        y = 40
      }
      const count = Math.max(1, Math.floor((BOTTOM - y - 3) / 4))
      const current = lines.splice(0, count)
      const height = Math.max(10, 3 + current.length * 4)
      pdf.setDrawColor(220, 228, 222)
      pdf.setLineWidth(0.2)
      pdf.line(MARGIN, y + height, PAGE_WIDTH - MARGIN, y + height)
      if (first) {
        const position = placed.get(item.id)
        text(pdf, String(index + 1), 14, y + 5, 8, true)
        text(pdf, LABELS[item.kind], 24, y + 5, 7)
        text(pdf, String(item.weight), 151, y + 5, 8)
        text(pdf, position ? `${position.x} / ${position.y} cm` : 'OFFEN', 167, y + 5, 7)
      }
      current.forEach((line, lineIndex) =>
        text(pdf, line.value, 63, y + 5 + lineIndex * 4, line.bold ? 8 : 7, line.bold))
      y += height
      first = false
    }
  }
  if (!packList.cargo.length) text(pdf, 'Keine Packstuecke in der Packliste.', MARGIN, 154, 9)
}

export function createDriverPdf(vehicle: LoadedVehicle, packList: PackList): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  drawPlan(pdf, vehicle, packList)
  pdf.addPage()
  drawPackList(pdf, vehicle, packList)
  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page)
    pdf.setDrawColor(220, 228, 222)
    pdf.line(MARGIN, 280, PAGE_WIDTH - MARGIN, 280)
    text(pdf, 'Planungshilfe: Achslasten, Formschluss und Ladungssicherung gesondert pruefen.', MARGIN, 286, 7)
    text(pdf, `Seite ${page}/${pageCount}`, PAGE_WIDTH - 31, 286, 7)
  }
  return pdf
}
