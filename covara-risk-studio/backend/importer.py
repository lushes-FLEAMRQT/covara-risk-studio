"""Depot-Import ohne KI: CSV- und Excel-Tabellen lesen, Spalten erkennen, Positionen bilden.

Ablauf:
1. read_table(): Datei → Kopfzeile + Datenzeilen (alles als Text, Excel-Zahlen bleiben Zahlen).
2. guess(): Spalten für Name, ISIN, Ticker und Stückzahl anhand der Überschriften (und ISIN am Inhalt) erkennen.
3. positions(): mit einer Zuordnung die Positionen bilden; Summen-, Bargeld- und Leerzeilen fallen weg.
"""
from __future__ import annotations

import csv
import io
import os
import re

MAX_BYTES = 10 * 1024 * 1024
MAX_FILES = 5
MAX_ROWS = 500
FIELDS = ("name", "isin", "ticker", "qty")
TABLE_EXT = {".csv", ".txt", ".tsv", ".xlsx", ".xlsm"}
DOC_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"}  # liest Gemini (backend/gemini.py)

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# Überschriften (klein, ohne Sonderzeichen) je Feld; zuerst exakte Treffer, dann "enthält"
ALIASES = {
    "name": ["name", "bezeichnung", "wertpapier", "wertpapiername", "wertpapierbezeichnung", "titel", "instrument",
             "security", "securityname", "produkt", "gattung", "beschreibung", "description", "unternehmen", "aktie",
             "position", "fonds", "fondsname", "emittent", "papier"],
    "isin": ["isin", "isincode", "isinnummer"],
    "ticker": ["ticker", "symbol", "tickersymbol", "kuerzel", "kürzel", "yahoo", "yahoosymbol", "boersenkuerzel",
               "börsenkürzel", "yahooticker", "code"],
    "qty": ["stück", "stueck", "stk", "st", "anzahl", "menge", "bestand", "stückzahl", "stueckzahl", "nominale",
            "nominal", "quantity", "qty", "shares", "anteile", "units", "stückbestand", "stücknominale"],
}
# Wörter, die eine Spalte als Kurs/Wert ausweisen: nie als Stückzahl nehmen
NOT_QTY = ("kurs", "preis", "wert", "price", "value", "eur", "betrag", "summe", "datum", "date", "gewinn", "einstand")
# Zeilen, die keine Wertpapiere sind
SKIP_ROW = re.compile(r"^(summe|gesamt|total|zwischensumme|saldo|cash|bargeld|guthaben|verrechnungskonto|"
                      r"kontostand|liquidität|liquiditaet|depotwert|gesamtwert)\b", re.I)


class ReadError(Exception):
    """Fehler, die dem Nutzer direkt angezeigt werden können."""


def _key(s) -> str:
    return re.sub(r"[^a-z0-9äöüß]", "", str(s or "").lower())


def _text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def _cell(v) -> str | float:
    if v is None:
        return ""
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, (int, float)):
        return float(v)
    return str(v).replace(" ", " ").strip()


def _csv_rows(raw: bytes) -> list[list]:
    text = _text(raw)
    sample = "\n".join(text.splitlines()[:30])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delim = dialect.delimiter
    except csv.Error:
        counts = {d: sample.count(d) for d in ";\t,|"}
        delim = max(counts, key=counts.get)
    return [[_cell(c) for c in row] for row in csv.reader(io.StringIO(text), delimiter=delim)]


def _excel_rows(raw: bytes) -> list[list]:
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception:
        raise ReadError("Die Excel-Datei lässt sich nicht öffnen (nur .xlsx wird unterstützt).")
    best: list[list] = []
    for ws in wb.worksheets:  # Tabellenblatt mit den meisten gefüllten Zeilen
        rows = [[_cell(v) for v in r] for r in ws.iter_rows(values_only=True)]
        rows = [r for r in rows if any(c != "" for c in r)]
        if len(rows) > len(best):
            best = rows
    return best


def _header_score(row: list) -> int:
    keys = [_key(c) for c in row if isinstance(c, str)]
    return sum(any(k == a for f in FIELDS for a in ALIASES[f]) for k in keys if k)


def read_table(name: str, raw: bytes) -> dict:
    """Datei → {"columns": [...], "rows": [[...]], "header": bool}."""
    ext = os.path.splitext(name.lower())[1]
    if ext in (".xlsx", ".xlsm"):
        rows = _excel_rows(raw)
    elif ext in (".csv", ".txt", ".tsv"):
        rows = _csv_rows(raw)
    elif ext == ".xls":
        raise ReadError(f"{name}: altes Excel-Format. Bitte als .xlsx oder .csv speichern.")
    else:
        raise ReadError(f"{name}: Dateityp wird nicht unterstützt (CSV oder Excel).")
    rows = [r for r in rows if any(c != "" for c in r)]
    if not rows:
        raise ReadError(f"{name} enthält keine Tabelle.")
    # Kopfzeile: die Zeile mit den meisten bekannten Überschriften unter den ersten 15 (manche Exporte haben Vorspann)
    scores = [_header_score(r) for r in rows[:15]]
    hi = max(range(len(scores)), key=lambda i: scores[i])
    width = max(len(r) for r in rows)
    if scores[hi] > 0:
        head = [str(c).strip() if c != "" else f"Spalte {i + 1}" for i, c in enumerate(rows[hi])]
        data = rows[hi + 1:]
        header = True
    else:
        head, data, header = [], rows, False
    head += [f"Spalte {i + 1}" for i in range(len(head), width)]
    data = [r + [""] * (width - len(r)) for r in data][:MAX_ROWS]
    return {"columns": head, "rows": data, "header": header}


def guess(t: dict) -> tuple[dict, bool]:
    """Spalten erkennen. Gibt (Zuordnung {feld: index|None}, sicher?) zurück."""
    keys = [_key(c) for c in t["columns"]] if t["header"] else [""] * len(t["columns"])
    m: dict[str, int | None] = {f: None for f in FIELDS}
    used: set[int] = set()

    def pick(f, test):
        for i, k in enumerate(keys):
            if i not in used and k and test(k):
                m[f] = i
                used.add(i)
                return True
        return False

    for f in ("isin", "ticker", "qty", "name"):  # exakte Überschrift
        pick(f, lambda k, f=f: k in ALIASES[f])
    for f in ("isin", "ticker", "name"):  # Überschrift enthält das Wort
        if m[f] is None:
            pick(f, lambda k, f=f: any(a in k for a in ALIASES[f] if len(a) >= 4))
    if m["qty"] is None:
        pick("qty", lambda k: any(a in k for a in ALIASES["qty"] if len(a) >= 4) and not any(w in k for w in NOT_QTY))

    # ISIN am Inhalt erkennen (Spalte, in der die meisten Werte wie ISINs aussehen)
    rows = t["rows"][:50]
    if m["isin"] is None and rows:
        for i in range(len(t["columns"])):
            vals = [str(r[i]).strip().upper() for r in rows if r[i] != ""]
            if i not in used and vals and sum(bool(ISIN_RE.match(v)) for v in vals) / len(vals) >= 0.6:
                m["isin"] = i
                used.add(i)
                break

    sure = m["qty"] is not None and any(m[f] is not None for f in ("name", "isin", "ticker"))
    return m, sure


def qty_value(v, comma_decimal: bool) -> float | None:
    """'35,5' → 35.5 · '1.234,5' → 1234.5 · '1,234.5' → 1234.5 · '12 Stk.' → 12."""
    if isinstance(v, float):
        return v if v > 0 else None
    s = re.sub(r"[^\d.,\-]", "", str(v))
    if not s or not re.search(r"\d", s):
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if comma_decimal or s.count(",") == 1 and not re.search(r",\d{3}$", s) else s.replace(",", "")
    elif s.count(".") > 1 or (comma_decimal and re.search(r"\.\d{3}$", s)):
        s = s.replace(".", "")
    try:
        x = float(s)
    except ValueError:
        return None
    return x if x > 0 else None


def positions(t: dict, m: dict) -> tuple[list[dict], list[str]]:
    """Zuordnung anwenden. Gibt (Positionen, übersprungene Zeilen) zurück."""
    get = lambda r, f: (r[m[f]] if m.get(f) is not None and m[f] < len(r) else "")
    # Dezimaltrennzeichen der Stückzahl-Spalte: Komma, wenn irgendwo "12,5"-artige Werte stehen
    q = [str(get(r, "qty")) for r in t["rows"] if isinstance(get(r, "qty"), str)]
    comma = any(re.search(r",\d{1,2}$|,\d{4,}$|\.\d{3},|^0,", v.strip()) for v in q)
    out, skipped = [], []
    for r in t["rows"]:
        name = str(get(r, "name")).strip()
        isin = str(get(r, "isin")).strip().upper().replace(" ", "")
        tick = str(get(r, "ticker")).strip().upper()
        isin = isin if ISIN_RE.match(isin) else ""
        if not isin and ISIN_RE.match(tick):  # ISIN steht in der Ticker-Spalte
            isin, tick = tick, ""
        label = name or tick or isin
        if not label or SKIP_ROW.match(label):
            continue
        qty = qty_value(get(r, "qty"), comma) if m.get("qty") is not None else None
        if not (name or isin or tick):
            continue
        if qty is None and not (isin or tick) and not any(isinstance(c, float) for c in r):
            skipped.append(label)  # nur Text, keine Zahlen: Überschrift, Kategorie o. Ä.
            continue
        out.append({"name": label, "isin": isin or None, "symbol": tick or None, "quantity": qty})
    return out, skipped


def load(files: list[tuple[str, bytes]]) -> tuple[list[dict], list[tuple[str, bytes]]]:
    """Dateien prüfen und aufteilen: Tabellen (CSV/Excel, hier gelesen) und Dokumente (PDF/Bilder, für Gemini)."""
    if not files:
        raise ReadError("Keine Datei ausgewählt.")
    if len(files) > MAX_FILES:
        raise ReadError(f"Höchstens {MAX_FILES} Dateien auf einmal.")
    tables, docs = [], []
    for name, raw in files:
        ext = os.path.splitext(name.lower())[1]
        if not raw:
            raise ReadError(f"{name} ist leer.")
        if len(raw) > MAX_BYTES:
            raise ReadError(f"{name} ist größer als 10 MB.")
        if ext in DOC_EXT:
            docs.append((name, raw))
        elif ext == ".gif":
            raise ReadError(f"{name}: GIF wird nicht unterstützt. Bitte als PNG oder JPG speichern.")
        else:
            tables.append({"file": name, **read_table(name, raw)})
    return tables, docs
