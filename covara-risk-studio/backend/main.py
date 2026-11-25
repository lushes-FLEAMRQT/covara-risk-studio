"""Covara Risk Studio – Server.

Start (im Ordner covara/):
    .venv/bin/uvicorn backend.main:app --reload --port 8010
"""
from __future__ import annotations

import secrets
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")  # Schlüssel wie ANTHROPIC_API_KEY, nur serverseitig

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .data import MACRO, UNIVERSE, DataError, events, history, random_tickers, resolve
from .importer import ReadError, extract

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


@app.post("/api/import")
def api_import(request: Request, files: list[UploadFile] = File(...)):
    """Claude liest Positionen aus CSV, Excel, PDF oder Bildern; danach Abgleich mit Yahoo Finance."""
    need_login(request)
    raw = [(f.filename or "Datei", f.content_type or "", f.file.read()) for f in files]
    try:
        data = extract(raw)
    except ReadError as e:
        raise HTTPException(422, str(e))
    pos = [p for p in data.get("positions", []) if (p.get("symbol") or p.get("isin"))]
    checked = yahoo(lambda: resolve([{"symbol": p.get("symbol"), "isin": p.get("isin")} for p in pos])) if pos else []
    def note(p, c):
        if c.get("fixed_from"):
            return f"Symbol {c['fixed_from']} passte nicht zur ISIN, ersetzt durch {c['symbol']}"
        return p.get("note")
    rows = [{**c, "name_file": p["name"], "isin": p.get("isin"), "quantity": p.get("quantity"), "note": note(p, c)}
            for p, c in zip(pos, checked)]
    return {"rows": rows, "warnings": data.get("warnings", []),
            "skipped": [p["name"] for p in data.get("positions", []) if not (p.get("symbol") or p.get("isin"))]}


app.mount("/static", StaticFiles(directory=FRONTEND / "static"), name="static")
