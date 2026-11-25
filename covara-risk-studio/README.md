# Covara Risk Studio

Uni-Projekt: Portfolio-Risiko für Aktien und ETFs mit Value at Risk, Faktor-Analyse und Risiko-Wetter (Schwankungsprognose mit Terminen). Kurse kommen von Yahoo Finance (yfinance).

## Starten (lokal)

Im Projektordner (nach dem Entpacken heißt er `covara-risk-studio`):

```bash
cd covara-risk-studio
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env    # optional: GEMINI_API_KEY eintragen (nur für PDF/Screenshots nötig)
.venv/bin/uvicorn backend.main:app --reload --port 8010
```

Dann im Browser: http://localhost:8010 und mit dem Demo-Zugang einloggen.

## Seiten

| URL | Inhalt |
| --- | --- |
| `/` | Landing Page mit Trailer (synthetische Beispieldaten) |
| `/login` | Eigene Login-Seite, nur Demo-Zugang |
| `/app` | Studio (nur nach Login), sechs Bereiche, siehe unten |
| `/api/docs` | API-Dokumentation |

API-Endpunkte (alle außer Login brauchen die Demo-Sitzung):

| Endpunkt | Inhalt |
| --- | --- |
| `POST /api/history` | Tagesrenditen in Euro, S&P 500, Faktor-ETFs; zusätzlich `vix: {dates, level}` (^VIX auf die Handelstage gelegt) oder `null` |
| `POST /api/events` | `{tickers: [...]}` → je Ticker `{past: [...], next: [...]}`: vergangene Quartalszahlen-Termine und die der nächsten 95 Tage (Yahoo Finance, 12 Stunden Cache, Fehler ergeben leere Listen) |
| `GET /api/macro` | Fed-Zinsentscheide und US-Inflationsdaten aus `backend/data/macro_events.json` |

Bereiche im Studio (Hash in der Adresse):

| Hash | Bereich | Inhalt |
| --- | --- | --- |
| `#depot` | Depot laden | Import aus CSV oder Excel (Spalten automatisch erkannt, sonst per Auswahl zugeordnet), PDF oder Screenshot (Google Gemini), oder Demo-Portfolio |
| `#portfolio` | Portfolio | Urteil gegen einen S&P-500-ETF, die 3 wichtigsten Punkte mit Wirkung in Euro, Übersetzung der Zahlen, Wertverlauf, Risikoklasse, Positionen, Sektoren, Kennzahlen, Drawdown |
| `#risiko` | Risiko | drei Abschnitte: Verlust (VaR, ES, Histogramm), Aktien (Risikobeiträge, Was-wäre-wenn), Faktoren (Stil-Profil, Euro-Wirkung je Faktor) |
| `#vola` | Risiko-Wetter | Wetter für heute, 1 Woche, 1 Monat, 3 Monate; Schwankung mit Prognose-Fächer und Terminen; was kommt; Sturmtreiber; Markt gegen Modell (VIX); Trefferquote; VaR mit Prognose |
| `#stress` | Stresstests | vier historische Krisen gegen einen S&P-500-ETF, eigenes Szenario |
| `#einstellungen` | Einstellungen | Sicherheit und Zeitraum der Risikomessung, Farbmodus |

Jede Seite folgt demselben Muster: Urteil mit Maßstab, Übersetzung in Alltagssprache, Hebel mit Wirkung in Euro.
Fachdetails (Methodenvergleich, t-Werte, R², Alpha, GARCH-Parameter, Tracking Error, Calmar, Sortino) stehen eingeklappt
unter „Für Profis“. Alte Links funktionieren weiter: `#uebersicht` und `#kennzahlen` führen zu `#portfolio`,
`#beitraege` und `#faktoren` zu `#risiko` und springen dort zum passenden Abschnitt.

## Wie gerechnet wird

- **Backend (`backend/`)**: lädt zwei Jahre Tagesschlusskurse über yfinance, rechnet sie in Euro um und liefert
  die Tagesrenditen plus den S&P 500 (`^GSPC`) als Markt. Zusätzlich die Faktor-ETFs IWM, IVE, IVW, MTUM, QUAL
  und USMV (fehlt einer, entfällt nur dieser Faktor). Kurse werden je Symbol 6 Stunden gecacht.
- **Browser (`frontend/static/app.js`)**: rechnet alles Weitere in `compute()`, die Ergebnisse hängen an `D`.
- **Value at Risk / Expected Shortfall**: historisch aus überlappenden Zeiträumen (1, 10 oder 21 Tage) der letzten
  zwei Jahre. Unter „Für Profis“ zusätzlich parametrisch, Monte Carlo und Cornish-Fisher.
- **Vergleich mit einem S&P-500-ETF** (`D.etf`): gleicher Betrag, gleiche Sicherheit, gleicher Zeitraum, VaR genauso
  historisch gerechnet. Volatilität = Standardabweichung der Tagesrenditen × √252. Ampel nach
  Verhältnis Depot-Volatilität / ETF-Volatilität: unter 0,9 ruhiger, bis 1,15 wie der Markt, bis 1,4 erhöht, darüber hoch.
- **Übersetzung** (`D.mean`): Überschreitungen pro Jahr = (1 − Sicherheit) × 252 / Zeitraum in Tagen.
  Verlustjahr: Wahrscheinlichkeit für ein Jahr im Minus unter Normalverteilung, als „etwa jedes X. Jahr“.
- **Die 3 wichtigsten Punkte** (`D.levers`): alle Kandidaten bekommen eine Wirkung in Euro, die drei größten werden gezeigt.
  - Klumpen: Aktie mit Risikoanteil über 1,3 × Gewicht und über 12 %; Gewicht auf 2/3, übrige anteilig größer;
    Wirkung = Änderung des parametrischen VaR (dieselbe Rechnung wie der Was-wäre-wenn-Regler).
  - Streuung: firmenspezifischer Risikoanteil über 15 %; 5 weitere gleich gewichtete Aktien senken diese Varianz um
    den Faktor n/(n+5).
  - Stil: Stil-Faktor mit |t| ≥ 2 und größtem |Beta|; Wirkung = |Beta| × 10 % × Depotwert.
  - Sektor: größter Sektor über 35 %; Wirkung, wenn er auf 25 % sinkt.
  - Wetter: Risiko-Wetter der nächsten Woche mindestens „Unruhig“; Wirkung = VaR 1 Woche (Prognose) − VaR 1 Woche (normal).
  - Gibt es weniger als drei, füllen positive Hinweise auf.
- **Risikobeiträge**: Euler-Zerlegung der Varianz (Anteil am Risiko gegen Gewicht).
- **Faktoren**: Regression der Depotrendite auf Markt, Größe (IWM − S&P 500), Value (IVE − IVW), Momentum,
  Qualität und Geringe Schwankung (jeweils ETF − S&P 500). Daraus das Stil-Profil als Satz, die Euro-Wirkung je
  Faktor bei 10 % Rückstand und die Risikozerlegung (Faktoren gegen firmenspezifisch).
- **Risiko-Wetter** (`D.w2`, Modell in `app.js` ab „Risiko-Wetter: Modell“):
  - GJR-GARCH(1,1) mit Varianz-Targeting ω = v0·(1 − α − γ/2 − β); α, γ, β per Maximum Likelihood auf einem groben
    Gitter (α 0–0,20, γ 0–0,30, β 0,60–0,99), danach zweimal feiner. GARCH(1,1) zum Vergleich (Log-Likelihood, AIC).
  - Prognose per gefilterter historischer Simulation: 2.000 Pfade × 63 Handelstage, je Tag ein zufälliges
    standardisiertes Residuum; daraus Perzentile 10/25/50/75/90 der Jahres-Schwankung und VaR/ES für 1, 5, 21, 63 Tage.
  - Termine: Aktien-Multiplikator m = Median max(|r_D|, |r_D+1|) an vergangenen Quartalszahlen / Median |r|
    (mindestens 1, ab 3 Terminen), Aufschlag Δvar = w²σ²(m² − 1). Fed und CPI: Multiplikator aus dem S&P 500 an
    vergangenen Terminen (sonst 1,3), Aufschlag β²σ_M²(m² − 1). Zukünftige Handelstage = Mo–Fr.
  - Stufen nach Median-Schwankung / Langfrist-Schwankung: Ruhig < 0,85, Wechselhaft < 1,15, Unruhig < 1,5, sonst Sturm;
    eine Stufe höher, wenn ein Termintag allein 1,5 erreicht.
  - Sturmtreiber: 5-Tage-GJR-Prognose je Aktie (α, γ, β des Depots, eigene Langfrist-Varianz) plus Termin-Aufschläge,
    Euler-Beiträge; Hebel = Gewicht des größten Treibers halbieren, Wirkung auf den parametrischen 1-Wochen-VaR.
  - Markt gegen Modell: √(β²·(VIX/100)² + firmenspezifische Varianz p.a.) gegen die 1-Monats-Prognose, ±15 %.
  - Trefferquote: Parameter nur auf den ersten 250 Handelstagen, danach fest vorwärts gefiltert; je Wochenstart
    300 Pfade × 5 Tage, Treffer, wenn die tatsächliche Wochen-Schwankung im 10–90-%-Band liegt; Vergleich mit
    „wie zuletzt“ (20-Tage-Schwankung).
  - Datenquellen: Quartalszahlen von Yahoo Finance; Fed-Termine von federalreserve.gov (FOMC-Kalender, zweiter
    Sitzungstag); CPI-Termine von bls.gov (Release-Kalender); VIX (^VIX) von Yahoo Finance.
- **Stresstests**: Beta × Marktbewegung + geschätzter Sektoraufschlag; der ETF verliert genau die Marktbewegung.
- **Depot-Import** (`backend/importer.py`, `POST /api/import`): liest CSV (Trennzeichen `;` `,` Tab) und Excel (.xlsx),
  sucht die Kopfzeile in den ersten 15 Zeilen und erkennt Name, ISIN, Ticker und Stückzahl an typischen Überschriften
  (z. B. „Wertpapierbezeichnung“, „Stück/Nominale“, „Anzahl“, „Quantity“), ISINs auch am Inhalt. Deutsche und englische
  Zahlen (`1.234,5` / `1,234.5`) werden verstanden, Summen- und Bargeldzeilen übersprungen. Ist die Erkennung unsicher,
  ordnet man die Spalten im Browser per Auswahl zu (`mapping` im Formular). Zeilen ohne ISIN/Ticker und nicht gefundene
  Ticker sucht Covara über den Namen bei Yahoo Finance (Hinweis „bitte prüfen“). Danach Prüfliste wie gehabt.
- **PDF/Screenshot-Import** (`backend/gemini.py`): schickt PDF, PNG, JPG, WEBP oder HEIC an Google Gemini
  (`gemini-3.5-flash-lite`, Gratis-Kontingent; per `GEMINI_MODEL` änderbar) und bekommt Positionen als JSON nach festem
  Schema zurück. Nur mit `GEMINI_API_KEY` auf dem Server, sonst eine verständliche Meldung; CSV/Excel gehen immer.
  Achtung: Im Gratis-Kontingent darf Google die Inhalte zur Verbesserung seiner Produkte nutzen. Die App weist darauf hin.
- Der Trailer auf der Startseite nutzt ein festes Beispielportfolio mit simulierten Kursen.

Hebel zeigen, was eine Änderung bewirken würde. Das ist keine Anlageberatung.

## Kommt später

- Eigene Benutzerkonten

## Schlüssel und Einstellungen (.env)

API-Schlüssel (ab Schritt 2: `GEMINI_API_KEY` für PDF/Screenshots) gehören in die Datei `.env` im Projektordner. Sie ist in `.gitignore`
eingetragen und wird **nie** zu GitHub gepusht. Als Vorlage dient `.env.example`:

```bash
cp .env.example .env   # Schlüssel eintragen und Server neu starten
```

Der Server liest die Datei beim Start (`python-dotenv`); die Werte bleiben auf dem Server und gehen nie an den Browser.
