import { describe, expect, it } from 'vitest'
import { createDriverPdf } from './pdf'
import { type Cargo, type LoadedVehicle, type PackList } from './model'

const item = (index: number): Cargo => ({
  id: `item-${index}`, kind: index % 3 === 0 ? 'rollcontainer' : 'pallet',
  name: `Packstueck ${index}`, description: `Hinweis fuer Packstueck ${index}`,
  weight: 100,
})

const vehicle: LoadedVehicle = {
  id: 'truck', name: 'Fahrzeug A', length: 1360, width: 248, maxPayload: 1000,
  limits: [
    { id: 'front', distance: 0, weight: 500 },
    { id: 'rear', distance: 1360, weight: 500 },
  ],
  cargo: [{ ...item(1), orientation: 'long', x: 0, y: 0 }],
}

function pageCommands(pdf: ReturnType<typeof createDriverPdf>, page: number): string {
  const commands: unknown = pdf.internal.pages[page]
  if (!Array.isArray(commands) || !commands.every((entry: unknown) => typeof entry === 'string')) {
    throw new Error(`PDF-Seite ${page} enthält keine Zeichenbefehle.`)
  }
  return commands.join('\n')
}

describe('Fahrer-PDF', () => {
  it('erstellt einen A4-Hochformatplan und eine Seite mit Packliste und Lastdiagramm', () => {
    const list: PackList = { id: 'list', name: 'Auftrag', cargo: [item(1), item(2)] }
    const pdf = createDriverPdf(vehicle, list)
    expect(pdf.getNumberOfPages()).toBe(2)
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210)
    expect(pdf.internal.pageSize.getHeight()).toBeCloseTo(297)
    expect(pageCommands(pdf, 1)).toContain('LADEPLAN')
    expect(pageCommands(pdf, 2)).toContain('LASTVERTEILUNG')
    expect(pageCommands(pdf, 2)).toContain('OFFEN')
    expect(pdf.output()).toMatch(/^%PDF-/)
  })

  it('führt lange Packlisten ohne abgeschnittene Einträge auf weiteren Seiten fort', () => {
    const list: PackList = {
      id: 'large', name: 'Grosser Auftrag',
      cargo: Array.from({ length: 50 }, (_, index) => item(index + 1)),
    }
    const pdf = createDriverPdf(vehicle, list)
    expect(pdf.getNumberOfPages()).toBeGreaterThan(2)
    expect(Array.from({ length: pdf.getNumberOfPages() - 1 }, (_, index) =>
      pageCommands(pdf, index + 2)).join('\n')).toContain('Packstueck 50')
    expect(pageCommands(pdf, 3)).toContain('FORTSETZUNG')
  })

  it('übernimmt auch mehrseitige Beschreibungen vollständig', () => {
    const description = 'Sehr langes Packstueck. '.repeat(750)
    const list: PackList = { id: 'long', name: 'Auftrag',
      cargo: [{ ...item(1), description }, item(2)] }
    const pdf = createDriverPdf(vehicle, list)
    expect(pdf.getNumberOfPages()).toBeGreaterThan(2)
    expect(Array.from({ length: pdf.getNumberOfPages() - 1 }, (_, index) =>
      pageCommands(pdf, index + 2)).join('\n')).toContain('Packstueck 2')
  })
})
