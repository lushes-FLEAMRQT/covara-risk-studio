"""Kursdaten von Yahoo Finance (yfinance), umgerechnet in Euro.

Demo-Portfolios kommen aus dem S&P 500, importierte Depots dürfen jedes Yahoo-Symbol enthalten
(z. B. SAP.DE, IWDA.AS, VOD.L). Kurse und Stammdaten werden je Symbol 6 Stunden gecacht.
"""
from __future__ import annotations

import json
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

CACHE_TTL = 6 * 3600
PERIOD = "2y"            # zwei Jahre Tageskurse
MIN_DAYS = 400           # Aktie braucht fast volle zwei Jahre Historie
MARKET = "^GSPC"         # S&P 500 als Markt (für Beta, Wertverlauf, Backtest)
FX = "EURUSD=X"          # US-Dollar je Euro
VIX = "^VIX"             # erwartete Schwankung des S&P 500 (Optionsmarkt), optional
EVENT_TTL = 12 * 3600    # Termine der Quartalszahlen je Symbol 12 Stunden cachen
EVENT_AHEAD = 95         # Kalendertage nach vorn
# Faktor-ETFs (US-Aktien). Das Frontend bildet daraus Long-Short-Faktoren:
# Größe = IWM − S&P 500, Value = IVE − IVW, Momentum = MTUM − S&P 500,
# Qualität = QUAL − S&P 500, Geringe Schwankung = USMV − S&P 500.
FACTOR_ETFS = ["IWM", "IVE", "IVW", "MTUM", "QUAL", "USMV"]

UNIVERSE: list[dict] = json.loads((Path(__file__).parent / "data" / "sp500.json").read_text())
BY_TK = {u["tk"]: u for u in UNIVERSE}

_cache: dict[str, tuple[float, pd.Series | None]] = {}
_meta: dict[str, tuple[float, dict]] = {}
_events: dict[str, tuple[float, dict]] = {}
MACRO: list[dict] = json.loads((Path(__file__).parent / "data" / "macro_events.json").read_text())
_lock = threading.Lock()

# Yahoo-Sektoren (englisch) auf die deutschen GICS-Namen der App
SECTOR_DE = {
    "Technology": "Technologie", "Communication Services": "Kommunikation",
    "Consumer Cyclical": "Zykl. Konsum", "Financial Services": "Finanzen",
    "Healthcare": "Gesundheit", "Consumer Defensive": "Basiskonsum", "Energy": "Energie",
    "Industrials": "Industrie", "Utilities": "Versorger", "Basic Materials": "Grundstoffe",
    "Real Estate": "Immobilien",
}
FUND_TYPES = {"ETF", "MUTUALFUND"}
# Kurse in Unterwährung (Pence, Cent, Agorot) → Hauptwährung
SUBUNIT = {"GBp": ("GBP", 100), "GBX": ("GBP", 100), "ZAc": ("ZAR", 100), "ILA": ("ILS", 100)}


class DataError(Exception):
    """Fehler, die dem Nutzer direkt angezeigt werden können."""


def _closes(symbols: list[str]) -> dict[str, pd.Series | None]:
    """Schlusskurse je Symbol; fehlende werden in einem Rutsch von Yahoo geladen."""
    now = time.time()
    with _lock:
        have = {s: v for s, (t, v) in _cache.items() if s in symbols and now - t < CACHE_TTL}
    todo = [s for s in symbols if s not in have]
    if todo:
        df = yf.download(todo, period=PERIOD, interval="1d", auto_adjust=True,
                         progress=False, threads=True, group_by="column")
        close = None
        if df is not None and not df.empty:
            close = df["Close"] if isinstance(df.columns, pd.MultiIndex) else df[["Close"]].rename(columns={"Close": todo[0]})
        with _lock:
            for s in todo:
                ser = None
                if close is not None and s in close.columns:
                    ser = close[s].dropna().astype(float)
                    if ser.empty:
                        ser = None
                _cache[s] = (now, ser)
                have[s] = ser
    return have


def _long(ser: pd.Series | None) -> bool:
    return ser is not None and len(ser) >= MIN_DAYS


def norm(sym: str) -> str:
    """S&P-Ticker mit Punkt (BRK.B) → Yahoo-Schreibweise (BRK-B); andere Symbole bleiben, wie sie sind."""
    s = sym.strip().upper()
    dashed = s.replace(".", "-")
    return dashed if dashed in BY_TK else s


def meta(symbols: list[str]) -> dict[str, dict]:
    """Name, Sektor, Währung und Typ je Symbol. S&P-500-Werte aus der eigenen Liste, Rest von Yahoo."""
    now = time.time()
    out, todo = {}, []
    for s in symbols:
        if s in BY_TK:
            out[s] = {"name": BY_TK[s]["n"], "sector": BY_TK[s]["s"], "currency": "USD", "type": "EQUITY"}
            continue
        with _lock:
            hit = _meta.get(s)
        if hit and now - hit[0] < CACHE_TTL:
            out[s] = hit[1]
        else:
            todo.append(s)

    def fetch(s):
        try:
            i = yf.Ticker(s).info or {}
        except Exception:
            i = {}
        qt = i.get("quoteType") or ""
        sector = "ETF/Fonds" if qt in FUND_TYPES else SECTOR_DE.get(i.get("sector") or "", "Sonstige")
        return s, {"name": i.get("longName") or i.get("shortName") or s, "sector": sector,
                   "currency": i.get("currency") or "", "type": qt}

    if todo:
        with ThreadPoolExecutor(8) as ex:
            for s, m in ex.map(fetch, todo):
                with _lock:
                    _meta[s] = (now, m)
                out[s] = m
    return out


def _fx_pairs(currencies: set[str]) -> dict[str, str]:
    """Währung → Yahoo-Kurs „Einheiten je Euro“ (EURUSD=X usw.)."""
    pairs = {}
    for c in currencies:
        main = SUBUNIT.get(c, (c, 1))[0]
        if main and main != "EUR":
            pairs[c] = f"EUR{main}=X"
    return pairs


def _to_eur(ser: pd.Series, cur: str, fx: dict[str, pd.Series]) -> pd.Series:
    div = SUBUNIT.get(cur, (cur, 1))[1]
    if cur in fx:
        rate = fx[cur].reindex(ser.index.union(fx[cur].index)).ffill().reindex(ser.index).bfill()
        ser = ser / rate
    return ser / div


def history(tickers: list[str]) -> dict:
    """Tägliche Renditen in Euro für alle Positionen und den Markt (S&P 500).

    Börsen haben unterschiedliche Feiertage: Kurse werden auf dem gemeinsamen Kalender
    fortgeschrieben, damit keine Handelstage verloren gehen.
    """
    tickers = [norm(t) for t in tickers if t and t.strip()]
    if len(tickers) < 2:
        raise DataError("Mindestens zwei Positionen werden benötigt.")
    if len(set(tickers)) != len(tickers):
        raise DataError("Jedes Wertpapier darf nur einmal vorkommen.")

    info = meta(tickers)
    fxp = _fx_pairs({info[t]["currency"] for t in tickers} | {"USD"})
    px = _closes(tickers + [MARKET, VIX] + list(set(fxp.values())) + FACTOR_ETFS)
    fx = {c: px.get(p) for c, p in fxp.items()}
    if px.get(MARKET) is None or fx.get("USD") is None:
        raise DataError("Markt- oder Wechselkursdaten fehlen gerade bei Yahoo Finance.")
    bad_fx = sorted({c for c in fx if fx[c] is None and any(info[t]["currency"] == c for t in tickers)})
    if bad_fx:
        raise DataError("Kein Wechselkurs bei Yahoo Finance für: " + ", ".join(bad_fx) + ".")
    missing = [t for t in tickers if not _long(px.get(t))]
    if missing:
        raise DataError("Keine zwei Jahre Kurshistorie für: " + ", ".join(missing) + ".")

    eur = {t: _to_eur(px[t], info[t]["currency"], fx) for t in tickers}
    eur[MARKET] = _to_eur(px[MARKET], "USD", fx)
    frame = pd.DataFrame(eur).sort_index().ffill().dropna(how="any")
    ret = frame.pct_change().dropna(how="any")
    if len(ret) < MIN_DAYS - 20:
        raise DataError("Zu wenige gemeinsame Handelstage.")

    r6 = lambda s: np.round(s.to_numpy(), 6).tolist()

    # Faktor-ETFs sind optional: fehlt einer bei Yahoo, entfällt nur dieser Faktor.
    factors = {}
    for f in FACTOR_ETFS:
        ser = px.get(f)
        if ser is None:
            continue
        fr = _to_eur(ser, "USD", fx).reindex(frame.index.union(ser.index)).ffill().reindex(frame.index).pct_change().reindex(ret.index)
        if fr.isna().mean() > 0.02:
            continue
        factors[f] = r6(fr.fillna(0.0))

    # VIX ist optional: Indexpunkte, auf die gemeinsamen Handelstage gelegt
    vix = None
    vs = px.get(VIX)
    if vs is not None:
        vr = vs.reindex(frame.index.union(vs.index)).ffill().reindex(ret.index)
        if vr.isna().mean() < 0.05:
            vix = {"dates": [d.date().isoformat() for d in ret.index], "level": np.round(vr.bfill().to_numpy(), 2).tolist()}

    return {
        "tickers": tickers,
        "names": [info[t]["name"] for t in tickers],
        "sectors": [info[t]["sector"] for t in tickers],
        "currencies": [info[t]["currency"] for t in tickers],
        "dates": [d.date().isoformat() for d in ret.index],
        "last": [round(float(frame[t].iloc[-1]), 2) for t in tickers],   # letzter Kurs in Euro
        "market": r6(ret[MARKET]),
        "returns": [r6(ret[t]) for t in tickers],
        "factors": factors,                                               # Tagesrenditen der Faktor-ETFs in Euro
        "vix": vix,                                                       # None, wenn Yahoo keinen VIX liefert
    }


def events(tickers: list[str]) -> dict[str, dict]:
    """Termine der Quartalszahlen je Symbol: vergangene und die der nächsten 95 Tage.

    Fehler bei einzelnen Symbolen (ETFs, fehlende Daten) ergeben leere Listen.
    """
    today = pd.Timestamp.now().normalize().date()
    ahead = today + pd.Timedelta(days=EVENT_AHEAD)
    syms = list(dict.fromkeys(norm(t) for t in tickers if t and t.strip()))
    now = time.time()
    out, todo = {}, []
    for s in syms:
        with _lock:
            hit = _events.get(s)
        if hit and now - hit[0] < EVENT_TTL:
            out[s] = hit[1]
        else:
            todo.append(s)

    def fetch(s):
        try:
            df = yf.Ticker(s).get_earnings_dates(limit=12)
            days = sorted({d.date() for d in df.index}) if df is not None and len(df) else []
        except Exception:
            days = []
        return s, {"past": [d.isoformat() for d in days if d < today],
                   "next": [d.isoformat() for d in days if today <= d <= ahead]}

    if todo:
        with ThreadPoolExecutor(8) as ex:
            for s, ev in ex.map(fetch, todo):
                with _lock:
                    _events[s] = (now, ev)
                out[s] = ev
    return out


def random_tickers(seed: int | None = None) -> list[str]:
    """8 bis 12 zufällige S&P-500-Aktien, die genug Historie bei Yahoo haben."""
    rnd = random.Random(seed)
    n = rnd.randint(8, 12)
    pool = rnd.sample(UNIVERSE, n + 6)                # Reserve, falls einzelne Kurse fehlen
    px = _closes([u["tk"] for u in pool])
    ok = [u["tk"] for u in pool if _long(px.get(u["tk"]))]
    if len(ok) < 8:
        raise DataError("Yahoo Finance liefert gerade zu wenige Kurse. Bitte erneut würfeln.")
    return ok[:n]


def _looks_isin(s: str) -> bool:
    return len(s) == 12 and s[:2].isalpha() and s[2:].isalnum()


def _search(q: str) -> str | None:
    try:
        quotes = yf.Search(q, max_results=5).quotes
    except Exception:
        return None
    for x in quotes:
        if x.get("symbol") and x.get("quoteType") in ("EQUITY", "ETF", "MUTUALFUND"):
            return x["symbol"]
    return None


def search_names(names: list[str]) -> list[str | None]:
    """Yahoo-Suche nach Wertpapiernamen (für Zeilen ohne ISIN und Ticker), parallel."""
    with ThreadPoolExecutor(8) as ex:
        return list(ex.map(lambda n: norm(h) if (h := _search(n)) else None, names))


_FILLER = {"inc", "ag", "se", "sa", "nv", "plc", "corp", "corporation", "co", "company", "the", "ltd", "group",
           "holding", "holdings", "ucits", "etf", "acc", "dist", "usd", "eur", "class", "cl", "a", "b", "c",
           "registered", "shares", "reg", "shs", "namens", "aktien", "aktiengesellschaft", "1c", "on"}


def _same(a: str, b: str) -> bool:
    """Grober Namensvergleich, um ein falsch geschätztes Symbol zu erkennen."""
    tok = lambda s: {w for w in "".join(c if c.isalnum() else " " for c in s.lower()).split() if w not in _FILLER}
    x, y = tok(a), tok(b)
    if not x or not y:
        return True
    return len(x & y) / len(x | y) >= 0.6


def resolve(items: list[dict]) -> list[dict]:
    """Prüft Positionen gegen Yahoo Finance: Symbol, Name, Währung, letzter Kurs in Euro, Historie.

    items: [{"symbol": str|None, "isin": str|None}]
    """
    syms = []
    for it in items:
        sym = norm(it.get("symbol") or "")
        if not sym and it.get("isin"):
            sym = it["isin"].strip().upper()
        if _looks_isin(sym):                      # ISIN → Yahoo-Symbol, bevor Kurse geladen werden
            sym = norm(_search(sym) or sym)
        syms.append(sym)
    px = _closes([s for s in set(syms) if s and not _looks_isin(s)])
    # Symbol ohne Kurse: über ISIN oder Suche auflösen (z. B. ISIN statt Ticker in der Datei)
    for k, (it, sym) in enumerate(zip(items, syms)):
        if sym and px.get(sym) is not None:
            continue
        for q in (it.get("isin"),):
            if q and _looks_isin(q.strip().upper()):
                hit = _search(q.strip().upper())
                if hit:
                    syms[k] = norm(hit)
                    break
    todo = [s for s in set(syms) if s and s not in px]
    if todo:
        px.update(_closes(todo))

    # Symbol und ISIN gegeneinander prüfen: zeigt die ISIN auf ein anderes Wertpapier, gilt die ISIN
    fixed = [None] * len(syms)
    isin_idx = [k for k, it in enumerate(items)
                if it.get("isin") and _looks_isin(it["isin"].strip().upper()) and syms[k] and px.get(syms[k]) is not None]
    if isin_idx:
        with ThreadPoolExecutor(8) as ex:
            hits = list(ex.map(lambda k: _search(items[k]["isin"].strip().upper()), isin_idx))
        cand = {k: norm(h) for k, h in zip(isin_idx, hits) if h and norm(h) != syms[k]}
        if cand:
            names = meta(list({syms[k] for k in cand} | set(cand.values())))
            for k, h in cand.items():
                if not _same(names[syms[k]]["name"], names[h]["name"]):
                    more = _closes([h])
                    if more.get(h) is not None:
                        px.update(more)
                        fixed[k], syms[k] = syms[k], h

    found = [s for s in set(syms) if s and px.get(s) is not None]
    info = meta(found)
    fxp = _fx_pairs({info[s]["currency"] for s in found})
    fxs = _closes(list(set(fxp.values()))) if fxp else {}
    fx = {c: fxs.get(p) for c, p in fxp.items()}

    out = []
    for k, sym in enumerate(syms):
        r = {"symbol": sym, "ok": False, "reason": "", "name": "", "sector": "", "currency": "", "last": None, "days": 0,
             "fixed_from": fixed[k]}
        ser = px.get(sym) if sym and not _looks_isin(sym) else None
        if not sym:
            r["reason"] = "Kein Symbol"
        elif ser is None:
            r["reason"] = "Bei Yahoo Finance nicht gefunden"
        else:
            m = info[sym]
            cur = m["currency"]
            r.update(name=m["name"], sector=m["sector"], currency=cur, days=len(ser))
            if cur in fx and fx[cur] is None:
                r["reason"] = f"Kein Wechselkurs für {cur}"
            else:
                r["last"] = round(float(_to_eur(ser, cur, fx).iloc[-1]), 2)
                if not _long(ser):
                    r["reason"] = f"Nur {len(ser)} Handelstage Historie, nötig sind {MIN_DAYS}"
                else:
                    r["ok"] = True
        out.append(r)
    return out
