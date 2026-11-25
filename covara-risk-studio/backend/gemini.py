"""PDF- und Screenshot-Import über Google Gemini (Gratis-Kontingent).

Der Schlüssel steht nur auf dem Server in der Umgebungsvariable GEMINI_API_KEY (Render: Environment, lokal: .env).
Ohne Schlüssel gibt es eine verständliche Meldung, CSV und Excel funktionieren trotzdem.
Aufruf per HTTP (generateContent), Antwort als JSON nach festem Schema.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import ssl
import time
import urllib.error
import urllib.request

from .importer import ReadError

try:  # Zertifikate aus certifi: manche Mac-Pythons haben keine eigenen
    import certifi
    _SSL = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL = ssl.create_default_context()

MODEL_DEFAULT = "gemini-3.5-flash-lite"   # stabil, Gratis-Kontingent, für Dokumente gedacht (Stand 11/2026)
FALLBACK_DEFAULT = "gemini-3.1-flash-lite"  # zweites Gratis-Modell, falls das erste überlastet ist
RETRY = {429, 500, 502, 503, 504}          # überlastet/Kontingent: kurz warten, dann Ersatzmodell (eigenes Kontingent)
log = logging.getLogger("uvicorn.error")
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TIMEOUT = 120
MAX_INLINE = 14 * 1024 * 1024             # Google erlaubt 20 MB je Anfrage, Base64 macht Dateien um 1/3 größer
MIME = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif"}

SYSTEM = """Du liest Depotauszüge, Broker-Übersichten und Screenshots von Wertpapierdepots und gibst die enthaltenen Positionen zurück.

Für jede Position:
- name: Name des Wertpapiers, wie er in der Datei steht.
- isin: ISIN, falls in der Datei vorhanden, sonst null. Nie erfinden.
- symbol: das passende Symbol bei Yahoo Finance. US-Aktien ohne Endung (AAPL, BRK-B), sonst mit Börsen-Endung: Xetra .DE, London .L, Amsterdam .AS, Paris .PA, Mailand .MI, Schweiz .SW, Wien .VI, Madrid .MC, Toronto .TO, Tokio .T. Für ETFs die Notierung in Euro bevorzugen (meist .DE oder .AS). Steht ein Ticker in der Datei, diesen übernehmen. Wenn du unsicher bist, null.
- quantity: Anzahl der Stücke (Anteile), nicht der Wert in Euro. Bruchstücke sind erlaubt. Steht nur ein Wert und keine Stückzahl da, null.
- note: nur bei echter Unsicherheit ein kurzer deutscher Hinweis (z. B. "Stückzahl schlecht lesbar"), sonst null.

Nicht aufnehmen: Bargeld, Verrechnungskonto, Summenzeilen, Kryptowährungen, Anleihen ohne Börsensymbol, Sparpläne ohne Bestand.
Kommt dasselbe Wertpapier mehrfach vor, die Stückzahlen zusammenzählen.
Unter warnings knappe deutsche Hinweise auf Probleme mit der Datei (unleserlich, abgeschnitten, keine Positionen gefunden). Leer, wenn alles in Ordnung ist.
Persönliche Daten wie Name, Adresse oder Depotnummer nie zurückgeben."""

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
            },
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["positions", "warnings"],
}

NO_KEY = ("PDF und Screenshots brauchen den Gemini-Zugang, der auf diesem Server nicht eingerichtet ist. "
          "CSV und Excel funktionieren trotzdem.")


def available() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def model() -> str:
    return os.environ.get("GEMINI_MODEL", "").strip() or MODEL_DEFAULT


def models() -> list[str]:
    """Hauptmodell, dann Ersatzmodell (GEMINI_FALLBACK_MODEL, leer lassen = Standard, \"-\" = keins)."""
    fb = os.environ.get("GEMINI_FALLBACK_MODEL", "").strip() or FALLBACK_DEFAULT
    return [model()] + ([fb] if fb not in ("-", model()) else [])


def _error(code: int, body: str) -> ReadError:
    try:
        err = json.loads(body).get("error", {})
    except (json.JSONDecodeError, AttributeError):
        err = {}
    msg = str(err.get("message", "")).lower()
    status = str(err.get("status", "")).upper()
    if "api key" in msg or code in (401, 403) or status in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
        return ReadError("Der Gemini-Schlüssel ist ungültig oder hat keine Berechtigung. Bitte GEMINI_API_KEY prüfen.")
    if code == 429:
        return ReadError("Das Gratis-Kontingent von Gemini ist gerade aufgebraucht (pro Minute oder pro Tag). "
                         "Bitte später noch einmal versuchen oder CSV/Excel nutzen.")
    if code == 404:
        return ReadError(f"Das Gemini-Modell „{model()}“ ist nicht verfügbar. Bitte GEMINI_MODEL prüfen.")
    if code == 400:
        return ReadError("Gemini konnte die Datei nicht verarbeiten (zu groß, beschädigt oder passwortgeschützt).")
    return ReadError("Gemini ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.")


def extract(files: list[tuple[str, bytes]]) -> dict:
    """PDFs/Bilder an Gemini schicken. Gibt {"positions": [...], "warnings": [...]} zurück."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise ReadError(NO_KEY)
    if sum(len(raw) for _, raw in files) > MAX_INLINE:
        raise ReadError("PDFs und Bilder zusammen dürfen höchstens 14 MB groß sein. Bitte einzeln hochladen.")
    parts: list[dict] = []
    for name, raw in files:
        ext = os.path.splitext(name.lower())[1]
        if ext not in MIME:
            raise ReadError(f"{name}: Dateityp wird nicht unterstützt (PDF, PNG, JPG, WEBP, HEIC).")
        parts += [{"text": f"Datei: {name}"},
                  {"inline_data": {"mime_type": MIME[ext], "data": base64.standard_b64encode(raw).decode("ascii")}}]
    parts.append({"text": "Lies alle Wertpapierpositionen aus diesen Dateien aus."})
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": SCHEMA,
            "thinkingConfig": {"thinkingLevel": "low"},
            "maxOutputTokens": 16000,
        },
    }
    data = json.dumps(body).encode()
    # Versuche: Hauptmodell, nach kurzer Pause noch einmal, dann das Ersatzmodell
    tries = [(models()[0], 0), (models()[0], 2)] + [(m, 0) for m in models()[1:]]
    last: ReadError | None = None
    for m, wait in tries:
        time.sleep(wait)
        req = urllib.request.Request(URL.format(model=m), data=data, method="POST",
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=_SSL) as r:
                return parse(json.loads(r.read()))
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            log.warning("Gemini %s: HTTP %s %s", m, e.code, text[:300].replace("\n", " "))
            if m != models()[0]:      # Ersatzmodell klappt auch nicht: Fehler des Hauptmodells zeigen
                continue
            last = _error(e.code, text)
            if e.code not in RETRY:
                raise last
        except (urllib.error.URLError, TimeoutError) as e:
            log.warning("Gemini %s: keine Verbindung (%s)", m, e)
            last = ReadError("Keine Verbindung zu Gemini. Bitte gleich noch einmal versuchen.")
    raise ReadError("Gemini ist gerade überlastet. Bitte in ein paar Minuten noch einmal versuchen "
                    "oder CSV/Excel nutzen.") if last and "nicht erreichbar" in str(last) else last


def parse(res: dict) -> dict:
    """Antwort von generateContent auswerten."""
    if (res.get("promptFeedback") or {}).get("blockReason"):
        raise ReadError("Gemini hat die Datei abgelehnt.")
    cands = res.get("candidates") or []
    if not cands:
        raise ReadError("Gemini hat keine Antwort geliefert. Bitte erneut versuchen.")
    c = cands[0]
    reason = c.get("finishReason", "STOP")
    if reason == "MAX_TOKENS":
        raise ReadError("Die Datei enthält zu viele Positionen für einen Durchgang. Bitte aufteilen.")
    if reason not in ("STOP", "FINISH_REASON_UNSPECIFIED"):
        raise ReadError("Gemini hat die Datei abgelehnt.")
    text = "".join(p.get("text", "") for p in (c.get("content") or {}).get("parts", []) if not p.get("thought"))
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise ReadError("Die Antwort von Gemini war unvollständig. Bitte erneut versuchen.")
    pos = []
    for p in data.get("positions") or []:
        if not isinstance(p, dict) or not str(p.get("name") or "").strip():
            continue
        q = p.get("quantity")
        pos.append({"name": str(p["name"]).strip(), "isin": (p.get("isin") or None), "symbol": (p.get("symbol") or None),
                    "quantity": float(q) if isinstance(q, (int, float)) and q > 0 else None,
                    "note": p.get("note") or None})
    return {"positions": pos, "warnings": [str(w) for w in data.get("warnings") or []]}
