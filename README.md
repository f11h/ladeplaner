# Ladeplaner

Lokale Web-Anwendung zur 2D-Planung einer LKW-Ladefläche. Zuerst eine benannte Packliste mit Europaletten (80 × 120 cm), Euro-Gitterboxen (83 × 123 cm) und Rollcontainern (80 × 120 cm) erstellen, dann ein Fahrzeug wählen und Ladungsträger per Drag-and-Drop oder Auswahl und Antippen auf die Ladefläche bringen. Die Ausrichtung für neue Platzierungen lässt sich direkt in der Packliste wählen. Name, Beschreibung, Typ und Gewicht werden im Packstück-Modal über den Stift in der Packliste bearbeitet; Position und Ausrichtung gehören zum Ladeplan der jeweiligen Fahrzeug-Packlisten-Kombination. Ein Doppelklick dreht einen platzierten Ladungsträger um 90°. Neue Einheiten wiegen zunächst 100 kg.

## Starten

```sh
npm install
npm run dev
```

`npm test` prüft Stellregeln, Lastberechnung und JSON-Import. `npm run build` erstellt die Produktionsdateien in `dist`.

## GitHub Pages

Bei jedem Push baut die GitHub Action die Anwendung und veröffentlicht sie unter `https://f11h.github.io/ladeplaner/`. Im Repository muss unter **Settings → Pages → Build and deployment** als Quelle **GitHub Actions** ausgewählt sein. Da jeder Branch-Push veröffentlicht wird, ersetzt der zuletzt deployte Stand die öffentliche Seite. Der Pages-Build verwendet `/ladeplaner/` als Basispfad; lokale Builds behalten den Standardpfad `/`.

## Planungsregeln

- Die Stirnseite ist oben; die Position in Längsrichtung wird von dort in Zentimetern gemessen.
- Maße und Kollisionen werden anhand der tatsächlichen Grundflächen geprüft. Innerhalb einer sich in Längsrichtung überdeckenden Querreihe ist nur eine Ausrichtung zulässig.
- Längs passen höchstens drei Einheiten nebeneinander, davon maximal zwei Gitterboxen; quer höchstens zwei Einheiten, davon maximal eine Gitterbox. Rollcontainer zählen dabei wie Europaletten. Zusätzlich müssen alle Einheiten tatsächlich auf die konfigurierte Ladefläche passen. Typänderungen, die einen gespeicherten Ladeplan ungültig machen würden, werden abgelehnt.
- Die freie Platzierung erzwingt keinen Formschluss. Sichtbare Lücken und die ausreichende Ladungssicherung müssen separat beurteilt werden.
- Beim Ziehen und Ablegen rasten Einheiten innerhalb von 8 cm an den Ladeflächenwänden, an den Kanten anderer Einheiten oder mittig zwischen zwei Einheiten mit passendem Zwischenraum ein. Es gibt kein Raster; ungültige oder kollidierende Zielpositionen werden nicht als Einrastpunkt verwendet.
- Über „Fahrzeug bearbeiten“ werden Fahrzeugname, Länge, Breite, zulässige Gesamtzuladung und der Lastverteilungsplan gemeinsam im Fahrzeug-Modal gepflegt. Ohne eingetragene Zuladung wird keine Freigabe unterstellt; überschreitet die verladene Ladung die angegebene Zuladung, warnt die Gewichtskachel. Maßänderungen, die bestehende Ladepläne ungültig machen, werden abgelehnt.
- Der Lastverteilungsplan enthält Wertepaare aus Abstand zur Stirnseite (cm) und zulässigem Querschnittsgewicht (kg). Zwischen Stützstellen wird linear interpoliert, außerhalb nicht extrapoliert. Die Ist-Kurve zeigt an jedem Abstand die **Summe der vollen Gewichte aller Ladungsträger, deren Stellfläche den dortigen Querschnitt schneidet**. Damit entsteht ein stufenförmiger Verlauf, der nur beladene Bereiche gegen den dortigen Grenzwert prüft. Überschreitungen sind rot markiert; beladene Bereiche außerhalb der Stützstellen bleiben ungeprüft. Die gesamte zulässige Zuladung wird getrennt in der Gewichtskachel geprüft.
- Das Lastverteilungsdiagramm lässt sich per Klick auf das kleine Diagramm oder über „Vergrößern“ in einem zentrierten Modal öffnen und über „Schließen“, Escape oder einen Klick auf den abgedunkelten Hintergrund schließen.

Mehrere Fahrzeuge, Packlisten und eigene Ladepläne je Kombination werden ausschließlich im `localStorage` des Browsers gespeichert. Bei erstmaligem Wechsel auf ein anderes Fahrzeug übernimmt die App alle dort gültigen Positionen; unpassende Ladungsträger bleiben auf der Packliste unverladen. Bestehende Ladepläne werden beim Zurückwechseln unverändert geladen. Ein platzierter Ladungsträger kann aus der Ladefläche hinausgezogen oder über „Entladen“ aus dem aktuellen Ladeplan entfernt werden; er bleibt in der Packliste und in Ladeplänen anderer Fahrzeuge erhalten. „Aus Packliste löschen“ entfernt ihn dagegen aus allen Plänen dieser Packliste.

„PDF exportieren“ erzeugt für die aktive Fahrzeug-Packlisten-Kombination einen A4-Ausdruck: Seite 1 enthält den maßstabsgetreuen Ladeplan mit nummerierten Packstücken und der Stirnseite oben; Seite 2 zeigt die vollständige Packliste mit Positionen und dem Lastverteilungsdiagramm. Lange Packlisten laufen auf Folgeseiten weiter. Unverladene Packstücke und Lastwarnungen werden im Ausdruck kenntlich gemacht.

Der JSON-Export enthält Fahrzeuge einschließlich Zuladung und Lastverteilungsplan, Packlisten, Ladepläne und aktive Auswahl. Beim Import wird die Datei vorab validiert; der bestehende Bestand wird erst nach ausdrücklicher Bestätigung ersetzt. Frühere JSON-Dateien und lokale Daten im alten Fahrzeugformat werden automatisch in je eine Packliste und einen Ladeplan pro Fahrzeug überführt; fehlende Angaben zur Zuladung bleiben unbekannt. Die Anwendung ist eine Planungshilfe und ersetzt weder Fahrzeughandbuch noch fachgerechte Last- und Ladungssicherungsprüfung.
