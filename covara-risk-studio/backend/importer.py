"""Depot-Import: Claude liest Positionen aus CSV, Excel, PDF oder Bildern (Screenshots, Fotos)."""
from __future__ import annotations

import base64
import csv
import io
import json
import os

import anthropic

# Modell für den Import; in .env mit COVARA_IMPORT_MODEL überschreibbar
MODEL = os.environ.get("COVARA_IMPORT_MODEL", "claude-sonnet-5-5")
# Server-seitiger Rückfall bei Ablehnung gibt es nur für Opus/Sonnet 5.5, nicht für Haiku
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}
MAX_BYTES = 10 * 1024 * 1024
MAX_FILES = 5
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
EXT_IMAGE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}

SYSTEM = """Du liest Depotauszüge, Broker-Exporte und Screenshots von Wertpapierdepots und gibst die enthaltenen Positionen zurück.

Für jede Position:
- name: Name des Wertpapiers, wie er in der Datei steht.
- isin: ISIN, falls in der Datei vorhanden, sonst null. Nie erfinden.
- symbol: das passende Symbol bei Yahoo Finance. US-Aktien ohne Endung (AAPL, BRK-B), sonst mit Börsen-Endung: Xetra .DE, London .L, Amsterdam .AS, Paris .PA, Mailand .MI, Schweiz .SW, Wien .VI, Madrid .MC, Toronto .TO, Tokio .T. Für ETFs die Notierung in Euro bevorzugen (meist .DE oder .AS). Steht ein Ticker in der Datei, diesen übernehmen und nur bei Bedarf die Endung ergänzen. Wenn unklar, die wahrscheinlichste Notierung wählen.
- quantity: Anzahl der Stücke (Anteile), nicht der Wert in Euro. Bruchstücke sind erlaubt. Steht nur ein Wert und keine Stückzahl da, null.
- note: nur bei echter Unsicherheit ein kurzer Hinweis (z. B. "Notierung unklar: ausschüttend oder thesaurierend", "Stückzahl aus Wert und Kurs berechnet"), sonst null. Bei eindeutigen Namen wie Apple → AAPL oder SAP → SAP.DE kein Hinweis, auch wenn keine ISIN dasteht.

Nicht aufnehmen: Bargeld, Verrechnungskonto, Summenzeilen, Kryptowährungen, Anleihen ohne Börsensymbol, Sparpläne ohne Bestand.
Kommt dasselbe Wertpapier mehrfach vor (z. B. in mehreren Dateien), die Stückzahlen zusammenzählen.
Unter warnings knappe Hinweise auf Probleme mit der Datei (unleserlich, abgeschnitten, keine Positionen gefunden). Leer, wenn alles in Ordnung ist."""

SCHEMA = {
    "type": "object",
    "properties": {
        "positions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "isin": {"type": ["string", "null"]},
                    "symbol": {"type": ["string", "null"]},
                    "quantity": {"type": ["number", "null"]},
                    "note": {"type": ["string", "null"]},
                },
                "required": ["name", "isin", "symbol", "quantity", "note"],
                "additionalProperties": False,
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["positions", "warnings"],
    "additionalProperties": False,
}


class ReadError(Exception):
    """Fehler, die dem Nutzer direkt angezeigt werden können."""


def _text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def _excel(raw: bytes) -> str:
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception:
        raise ReadError("Die Excel-Datei lässt sich nicht öffnen (nur .xlsx wird unterstützt).")
    parts = []
    for ws in wb.worksheets:
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        for row in ws.iter_rows(values_only=True):
            if any(v is not None and str(v).strip() for v in row):
                w.writerow(["" if v is None else v for v in row])
        if buf.getvalue().strip():
            parts.append(f"Tabellenblatt „{ws.title}“:\n{buf.getvalue()}")
    if not parts:
        raise ReadError("Die Excel-Datei ist leer.")
    return "\n\n".join(parts)


def _block(name: str, ctype: str, raw: bytes) -> list[dict]:
    ext = os.path.splitext(name.lower())[1]
    b64 = lambda: base64.standard_b64encode(raw).decode("ascii")
    if ctype in IMAGE_TYPES or ext in EXT_IMAGE:
        media = ctype if ctype in IMAGE_TYPES else EXT_IMAGE[ext]
        return [{"type": "text", "text": f"Datei: {name}"},
                {"type": "image", "source": {"type": "base64", "media_type": media, "data": b64()}}]
    if ctype == "application/pdf" or ext == ".pdf":
        return [{"type": "text", "text": f"Datei: {name}"},
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64()}}]
    if ext in (".xlsx", ".xlsm"):
        return [{"type": "text", "text": f"Datei: {name} (Excel, als CSV)\n\n{_excel(raw)}"}]
    if ext in (".csv", ".txt", ".tsv") or ctype.startswith("text/"):
        return [{"type": "text", "text": f"Datei: {name}\n\n{_text(raw)}"}]
    if ext in (".heic", ".heif"):
        raise ReadError(f"{name}: HEIC-Fotos werden nicht unterstützt. Bitte als JPG oder PNG speichern.")
    if ext == ".xls":
        raise ReadError(f"{name}: altes Excel-Format. Bitte als .xlsx oder .csv speichern.")
    raise ReadError(f"{name}: Dateityp wird nicht unterstützt (CSV, Excel, PDF, PNG oder JPG).")


def extract(files: list[tuple[str, str, bytes]], model: str | None = None) -> dict:
    """Schickt die Dateien an Claude und gibt {"positions": [...], "warnings": [...]} zurück."""
    if not files:
        raise ReadError("Keine Datei ausgewählt.")
    if len(files) > MAX_FILES:
        raise ReadError(f"Höchstens {MAX_FILES} Dateien auf einmal.")
    content: list[dict] = []
    for name, ctype, raw in files:
        if not raw:
            raise ReadError(f"{name} ist leer.")
        if len(raw) > MAX_BYTES:
            raise ReadError(f"{name} ist größer als 10 MB.")
        content += _block(name, ctype or "", raw)
    content.append({"type": "text", "text": "Lies alle Wertpapierpositionen aus diesen Dateien aus."})

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ReadError("Kein ANTHROPIC_API_KEY in der .env-Datei. Schlüssel eintragen und Server neu starten.")
    client = anthropic.Anthropic()
    model = model or MODEL
    extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"} if model in FALLBACK_MODELS else {}
    try:
        res = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            **extra,
            system=SYSTEM,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.AuthenticationError:
        raise ReadError("Der Anthropic-API-Schlüssel ist ungültig.")
    except anthropic.PermissionDeniedError:
        raise ReadError("Der Anthropic-API-Schlüssel hat keine Berechtigung für dieses Modell.")
    except anthropic.RateLimitError:
        raise ReadError("Zu viele Anfragen an Claude. Bitte kurz warten und erneut versuchen.")
    except anthropic.BadRequestError as e:
        msg = str(getattr(e, "message", e))
        if "credit" in msg.lower() or "billing" in msg.lower():
            raise ReadError("Das Anthropic-Konto hat kein Guthaben mehr.")
        raise ReadError("Claude konnte die Datei nicht verarbeiten (zu groß oder beschädigt).")
    except anthropic.APIStatusError:
        raise ReadError("Claude ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.")
    except anthropic.APIConnectionError:
        raise ReadError("Keine Verbindung zu Claude. Internetverbindung prüfen.")

    if res.stop_reason == "refusal":
        raise ReadError("Claude hat die Datei abgelehnt.")
    if res.stop_reason == "max_tokens":
        raise ReadError("Die Datei enthält zu viele Positionen für einen Durchgang. Bitte aufteilen.")
    text = next((b.text for b in res.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise ReadError("Claudes Antwort war unvollständig. Bitte erneut versuchen.")
    data["_usage"] = {"model": res.model, "in": res.usage.input_tokens, "out": res.usage.output_tokens}
    return data
