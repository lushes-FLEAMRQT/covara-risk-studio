"""Covara Risk Studio – Server.

Start (im Ordner covara/):
    .venv/bin/uvicorn backend.main:app --reload --port 8010
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")  # Schlüssel (z. B. GEMINI_API_KEY), nur serverseitig

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .data import MACRO, UNIVERSE, DataError, events, history, random_tickers, resolve, search_names
from .importer import FIELDS, ReadError, guess, load, positions

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
COOKIE = "covara_session"
SESSIONS: set[str] = set()  # nur Demo-Zugang, lebt so lange wie der Server

app = FastAPI(title="Covara Risk Studio", docs_url="/api/docs", redoc_url=None)


def logged_in(request: Request) -> bool:
    return request.cookies.get(COOKIE) in SESSIONS


def need_login(request: Request):
    if not logged_in(request):
        raise HTTPException(401, "Bitte zuerst anmelden.")


def yahoo(fn):
    try:
        return fn()
    except DataError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(502, "Yahoo Finance ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.")


# ---------- Seiten ----------
@app.get("/", include_in_schema=False)
def landing():
    return FileResponse(FRONTEND / "index.html")


@app.get("/login", include_in_schema=False)
def login_page(request: Request):
    if logged_in(request):
        return RedirectResponse("/app", status_code=303)
    return FileResponse(FRONTEND / "login.html")


@app.get("/app", include_in_schema=False)
def app_page(request: Request):
    if not logged_in(request):
        return RedirectResponse("/login", status_code=303)
    return FileResponse(FRONTEND / "app.html")


# ---------- Anmeldung (nur Demo) ----------
@app.post("/api/demo-login")
def demo_login():
    token = secrets.token_urlsafe(24)
    SESSIONS.add(token)
    res = JSONResponse({"ok": True, "user": "Demo-Zugang"})
    res.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=8 * 3600)
    return res


@app.post("/api/logout")
def logout(request: Request):
    SESSIONS.discard(request.cookies.get(COOKIE, ""))
    res = JSONResponse({"ok": True})
    res.delete_cookie(COOKIE)
    return res


# ---------- Daten ----------
@app.get("/api/universe")
def api_universe(request: Request):
    """Alle S&P-500-Aktien mit Name und Sektor (für „Aktie hinzufügen“)."""
    need_login(request)
    return UNIVERSE


class RandomIn(BaseModel):
    seed: int | None = None


@app.post("/api/random")
def api_random(body: RandomIn, request: Request):
    """Würfelt 8 bis 12 Aktien aus dem S&P 500 (Gewichte würfelt der Browser)."""
    need_login(request)
    return {"tickers": yahoo(lambda: random_tickers(body.seed))}


class HistoryIn(BaseModel):
    tickers: list[str] = Field(min_length=2, max_length=40)


@app.post("/api/history")
def api_history(body: HistoryIn, request: Request):
    """Zwei Jahre Tagesrenditen in Euro je Position plus S&P 500 als Markt."""
    need_login(request)
    return yahoo(lambda: history(body.tickers))


class EventsIn(BaseModel):
    tickers: list[str] = Field(min_length=1, max_length=40)


@app.post("/api/events")
def api_events(body: EventsIn, request: Request):
    """Termine der Quartalszahlen je Symbol: {"AAPL": {"past": [...], "next": [...]}}. Fehler je Symbol → leere Listen."""
    need_login(request)
    try:
        return events(body.tickers)
    except Exception:
        return {}


@app.get("/api/macro")
def api_macro(request: Request):
    """Fed-Zinsentscheide (FOMC) und US-Inflationsdaten (CPI) aus den offiziellen Kalendern."""
    need_login(request)
    return MACRO


class ResolveItem(BaseModel):
    symbol: str | None = Field(default=None, max_length=40)
    isin: str | None = Field(default=None, max_length=20)


class ResolveIn(BaseModel):
    items: list[ResolveItem] = Field(min_length=1, max_length=60)


@app.post("/api/resolve")
def api_resolve(body: ResolveIn, request: Request):
    """Prüft Symbole gegen Yahoo Finance (Name, Währung, Kurs in Euro, Länge der Historie)."""
    need_login(request)
    return yahoo(lambda: resolve([i.model_dump() for i in body.items]))


MAX_POSITIONS = 60


def _show(v) -> str:
    if isinstance(v, float):
        return f"{v:.6f}".rstrip("0").rstrip(".").replace(".", ",")
    return str(v)


def _mapping(raw: str | None) -> dict:
    """Zuordnung aus dem Browser: {"datei.csv": {"name": 0, "isin": 2, "ticker": null, "qty": 3}}."""
    if not raw:
        return {}
    try:
        m = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(422, "Die Spalten-Zuordnung ist ungültig.")
    ok = lambda v: v is None or (isinstance(v, int) and v >= 0)
    return {f: {k: v.get(k) for k in FIELDS if ok(v.get(k))} for f, v in m.items() if isinstance(v, dict)}


@app.post("/api/import")
def api_import(request: Request, files: list[UploadFile] = File(...), mapping: str | None = Form(None)):
    """CSV/Excel lesen, Spalten erkennen (oder Zuordnung aus dem Browser nutzen), danach Abgleich mit Yahoo Finance.

    Ist die Erkennung unsicher und kommt keine Zuordnung mit, gibt es nur die Tabellen-Vorschau (need_map = true).
    """
    need_login(request)
    given = _mapping(mapping)
    try:
        tables, warnings = load([(f.filename or "Datei", f.file.read()) for f in files])
    except ReadError as e:
        raise HTTPException(422, str(e))

    info, pos, skipped = [], [], []
    for t in tables:
        auto, sure = guess(t)
        m = given.get(t["file"]) or auto
        info.append({"file": t["file"], "columns": t["columns"], "mapping": m, "sure": sure or t["file"] in given,
                     "preview": [[_show(c) for c in r] for r in t["rows"][:6]], "n": len(t["rows"])})
        if m.get("qty") is None or not any(m.get(f) is not None for f in ("name", "isin", "ticker")):
            continue
        p, s = positions(t, m)
        pos += p
        skipped += s
    need_map = any(not x["sure"] for x in info)
    if need_map:
        return {"need_map": True, "tables": info, "rows": [], "warnings": warnings, "skipped": []}
    if len(pos) > MAX_POSITIONS:
        warnings.append(f"Nur die ersten {MAX_POSITIONS} von {len(pos)} Positionen übernommen.")
        pos = pos[:MAX_POSITIONS]

    # Zeilen nur mit Namen: Symbol über die Yahoo-Suche finden
    todo = [k for k, p in enumerate(pos) if not (p["symbol"] or p["isin"])]
    found = yahoo(lambda: search_names([pos[k]["name"] for k in todo])) if todo else []
    searched = set()
    for k, hit in zip(todo, found):
        if hit:
            pos[k]["symbol"] = hit
            searched.add(k)

    checked = yahoo(lambda: resolve([{"symbol": p["symbol"], "isin": p["isin"]} for p in pos])) if pos else []

    # Rückfall: Ticker/ISIN nicht gefunden (z. B. "ULVR" ohne Börsen-Endung) → über den Namen suchen
    miss = [k for k, c in enumerate(checked)
            if not c["symbol"] or c["reason"] == "Bei Yahoo Finance nicht gefunden"
            if k not in searched and pos[k]["name"] not in (pos[k]["symbol"], pos[k]["isin"])]
    if miss:
        hits = yahoo(lambda: search_names([pos[k]["name"] for k in miss]))
        again = [(k, h) for k, h in zip(miss, hits) if h]
        if again:
            redo = yahoo(lambda: resolve([{"symbol": h, "isin": None} for _, h in again]))
            for (k, _), c in zip(again, redo):
                if c["ok"]:
                    checked[k] = c
                    searched.add(k)

    def note(k, p, c):
        if c.get("fixed_from"):
            return f"Symbol {c['fixed_from']} passte nicht zur ISIN, ersetzt durch {c['symbol']}"
        if k in searched:
            return "Symbol aus dem Namen gesucht, bitte prüfen"
        if p["quantity"] is None:
            return "Keine Stückzahl erkannt"
        return None

    rows = [{**c, "name_file": p["name"], "isin": p["isin"], "quantity": p["quantity"], "note": note(k, p, c)}
            for k, (p, c) in enumerate(zip(pos, checked))]
    if not rows:
        warnings.append("Keine Wertpapierpositionen gefunden. Stimmt die Spalten-Zuordnung?")
    return {"need_map": False, "tables": info, "rows": rows, "warnings": warnings, "skipped": skipped}


app.mount("/static", StaticFiles(directory=FRONTEND / "static"), name="static")
