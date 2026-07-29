#!/usr/bin/env python3
"""Geocode incident places against OpenStreetMap's Nominatim and cache results.

The cache (data/geocache.json) is keyed by the raw "place | state" string, so
re-runs only hit the network for places not seen before. Nominatim's usage
policy allows 1 request/second from an identified client — respected below.

Entries that fail are written to the cache as null so they show up in the
report; fix them by hand in data/geocode.manual.json (same key -> {lat, lon}),
which always wins over the network result.

Usage: python3 scripts/geocode.py [--retry-failed]
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "incidents.raw.json"
# The working cache holds Nominatim's full-precision results and full display
# names, so it lives OUTSIDE the deployable Tracker/ folder entirely (the
# whole folder is what gets dragged onto a static host); data/geocache.json
# is a sanitised public copy written by merge() (2-dp coords, locality-level
# names only).
CACHE = ROOT.parent / "Tracker.geocache.private.json"
LEGACY_CACHE = ROOT / "data" / "geocache.json"
PUBLIC_CACHE = ROOT / "data" / "geocache.json"
MANUAL = ROOT / "data" / "geocode.manual.json"
OUT = ROOT / "data" / "incidents.json"

UA = "JEM-incident-tracker/1.0 (research documentation; contact: jem@jamiat.org)"
ENDPOINT = "https://nominatim.openstreetmap.org/search?"
DELAY = 1.1  # seconds between requests, per Nominatim usage policy


def load(path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default


def query(q):
    url = ENDPOINT + urllib.parse.urlencode({
        "q": q, "format": "jsonv2", "limit": 1, "countrycodes": "in",
    })
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        data = json.load(r)
    if not data:
        return None
    hit = data[0]
    return {
        "lat": float(hit["lat"]),
        "lon": float(hit["lon"]),
        "matched": hit.get("display_name", ""),
        "precision": hit.get("addresstype") or hit.get("type", ""),
    }


# Descriptive filler the log wraps around real place names — "Naugawan area of
# Auraiya district" is a place Nominatim knows only once this is stripped.
NOISE_RE = re.compile(
    r"\b(?:area of|area|region|locality|village|town|city|tehsil|taluka|block|"
    r"near|in|the|exact location not specified|not specified|district of)\b",
    re.I,
)
DISTRICT_RE = re.compile(r"([A-Za-z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?)\s+district", re.I)


def strip_noise(s):
    s = re.sub(r"\([^)]*\)", " ", s)          # drop parentheticals
    s = NOISE_RE.sub(" ", s)
    s = re.sub(r"[\s,]+", " ", s).strip(" ,-")
    return s


def candidates(place, state):
    """Progressively coarser queries — exact place first, state last.

    Each step throws away one layer of description, because the log writes
    places as prose ("Bordehi Railway Station, Betul district") rather than as
    a gazetteer would.
    """
    place = place.strip().rstrip(",")
    state = state.strip()
    tail = f", {state}, India" if state else ", India"
    out, seen = [], set()

    def add(q):
        q = re.sub(r"\s+", " ", (q or "")).strip()
        if q and len(q) > 6 and q not in seen:
            seen.add(q)
            out.append(q)

    add(place + tail)
    # a named district inside the string is the most reliable coarse anchor
    district = DISTRICT_RE.search(place)
    add(strip_noise(place) + tail)
    # each comma-separated part, longest-first (the specific name usually leads)
    for part in [p.strip() for p in place.split(",") if p.strip()]:
        add(strip_noise(part) + tail)
    if district:
        add(f"{district.group(1)} district{tail}")
    # first two words, a last attempt at the bare settlement name
    add(" ".join(strip_noise(place).split()[:2]) + tail)
    if state:
        add(f"{state}, India")
    return out


def main():
    retry_failed = "--retry-failed" in sys.argv or "--retry" in sys.argv
    # Also re-query places that only resolved to their state, in case an
    # improved query strategy can now place them precisely.
    retry_approx = "--retry-approx" in sys.argv or "--retry" in sys.argv
    incidents = load(RAW, [])
    cache = load(CACHE, None)
    if cache is None:
        # One-time migration from the old (served) cache location.
        cache = load(LEGACY_CACHE, {})
    manual = load(MANUAL, {})

    todo = []
    for inc in incidents:
        if not inc.get("geocodable"):
            continue
        key = f"{inc['place']} | {inc['state']}"
        if key in manual:
            continue
        if key in cache:
            hit = cache[key]
            stale = (retry_failed and hit is None) or (retry_approx and hit and hit.get("approximate"))
            if not stale:
                continue
        if key not in todo:
            todo.append(key)

    print(f"{len(todo)} places to geocode ({len(cache)} cached, {len(manual)} manual)")
    for n, key in enumerate(todo, 1):
        place, _, state = key.partition(" | ")
        result = None
        for q in candidates(place, state):
            try:
                result = query(q)
            except Exception as e:  # network hiccup — keep going, retry next run
                print(f"  ! {q}: {e}", file=sys.stderr)
            time.sleep(DELAY)
            if result:
                # Only the deliberate state-only fallback query counts as a
                # state-level pin — startswith() would mislabel real places
                # whose names begin with their state's name.
                result["approximate"] = (q == f"{state}, India") if state else False
                result["query"] = q
                break
        cache[key] = result
        flag = "ok " if result else "MISS"
        print(f"[{n}/{len(todo)}] {flag} {key}")
        if n % 10 == 0:
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))

    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1))
    merge(incidents, cache, manual)


LICENSE = "CC BY 4.0 — free to reuse with attribution to JEM (name and logo reserved)"
CITATION = ("Justice and Empowerment of Minorities (JEM). Hate Incident Tracker. "
            "Jamiat Ulama-i-Hind, New Delhi. https://jem.org.in/tracker/")

# Coordinates are published at 2 decimal places (~1.1 km) — the tracker maps
# localities, never addresses. Full Nominatim precision is deliberately not
# written to any shipped file (do-no-harm data minimisation for a hate-crime
# record; see the methodology page).
COORD_DP = 2


def stable_id(inc, used):
    """Content-derived id so permalinks survive re-ordering and re-imports.

    FNV-1a over place|date|description-head, mirrored exactly in assets/app.js
    (stableId) so live-sheet rows mint the same ids as this batch pipeline.
    """
    text = f"{inc.get('place', '')}|{inc.get('date') or ''}|{(inc.get('description') or '')[:80]}"
    # Hash UTF-16 code units so JS's charCodeAt() walk produces identical ids.
    enc = text.encode("utf-16-le")
    h = 0x811C9DC5
    for i in range(0, len(enc), 2):
        h ^= enc[i] | (enc[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    base = f"r{h:08x}"
    out, n = base, 2
    while out in used:
        out = f"{base}-{n}"
        n += 1
    used.add(out)
    return out


def public_match(matched):
    """Locality/district/state only — never the street-level head of the
    geocoder's display string (Nominatim orders specific → general)."""
    parts = [p.strip() for p in str(matched or "").split(",")]
    parts = [p for p in parts if p and p != "India" and not p[:1].isdigit()]
    return ", ".join(parts[-3:])


CSV_FIELDS = ["id", "ref", "date", "place", "state", "category", "minority",
              "description", "legal_status", "perpetrator", "affiliation",
              "intervention", "lat", "lon", "geo_approx", "sources"]


def write_csv(path, incidents, generated):
    import csv
    with path.open("w", newline="", encoding="utf-8") as f:
        f.write(f"# {CITATION}\n")
        f.write(f"# License: {LICENSE}\n")
        f.write(f"# Generated: {generated} · {len(incidents)} records\n")
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        for inc in incidents:
            row = dict(inc)
            row["sources"] = " ; ".join(
                s.get("url") or s.get("note", "") for s in inc.get("sources", []))
            row["geo_approx"] = "state-level" if inc.get("geo_approx") else (
                "locality" if "lat" in inc else "not mapped")
            w.writerow(row)


def merge(incidents, cache, manual):
    """Attach coordinates to incidents and write the site's data files."""
    missed = []
    used_ids = set()
    for inc in incidents:
        key = f"{inc['place']} | {inc['state']}"
        hit = manual.get(key) or cache.get(key)
        if hit:
            inc["lat"] = round(float(hit["lat"]), COORD_DP)
            inc["lon"] = round(float(hit["lon"]), COORD_DP)
            inc["geo_approx"] = bool(hit.get("approximate"))
            inc["geo_matched"] = public_match(hit.get("matched", ""))
        elif inc.get("geocodable"):
            missed.append(key)
        inc["id"] = stable_id(inc, used_ids)

    generated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload = {
        "generated": generated,
        "count": len(incidents),
        "license": LICENSE,
        "citation": CITATION,
        "incidents": incidents,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1))

    # Same payload as a plain script, so index.html also works when opened
    # straight off the disk (file:// blocks fetch of local JSON).
    (OUT.parent / "incidents.js").write_text(
        "/* Generated by scripts/geocode.py — do not edit by hand. */\n"
        "window.JEM_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n"
    )
    # Sanitised public cache: 2-dp coordinates, locality-level names, no raw
    # query strings — and the hand-corrected manual entries folded in, so
    # live-sheet rows keep their pins on refresh.
    public_cache = {}
    for k, v in cache.items():
        if not v:
            continue
        public_cache[k] = {
            "lat": round(float(v["lat"]), COORD_DP),
            "lon": round(float(v["lon"]), COORD_DP),
            "matched": public_match(v.get("matched", "")),
            "approximate": bool(v.get("approximate")),
        }
    for k, v in manual.items():
        public_cache[k] = {
            "lat": round(float(v["lat"]), COORD_DP),
            "lon": round(float(v["lon"]), COORD_DP),
            "matched": public_match(v.get("matched", "")),
            "approximate": bool(v.get("approximate")),
        }
    PUBLIC_CACHE.write_text(json.dumps(public_cache, ensure_ascii=False, indent=1))
    (OUT.parent / "geocache.js").write_text(
        "/* Generated by scripts/geocode.py — do not edit by hand. */\n"
        "window.JEM_GEOCACHE = " + json.dumps(public_cache, ensure_ascii=False) + ";\n"
    )

    # Researcher-facing CSV twin of the JSON.
    write_csv(OUT.parent / "incidents.csv", incidents, generated)

    # Frozen monthly snapshot — reproducibility for anyone who cited an earlier
    # figure. Named for the latest month present in the data.
    dates = sorted(d for d in (i.get("date") for i in incidents) if d)
    if dates:
        archive = OUT.parent / "archive"
        archive.mkdir(exist_ok=True)
        (archive / f"{dates[-1][:7]}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=1))

    placed = sum(1 for i in incidents if "lat" in i)
    approx = sum(1 for i in incidents if i.get("geo_approx"))
    print(f"\nwrote {OUT}")
    print(f"  {placed}/{len(incidents)} incidents placed ({approx} at state-level only)")
    if missed:
        print(f"  {len(missed)} unresolved — add to data/geocode.manual.json:")
        for k in sorted(set(missed)):
            print(f"    {k!r}: {{\"lat\": 0, \"lon\": 0}},")


if __name__ == "__main__":
    main()
