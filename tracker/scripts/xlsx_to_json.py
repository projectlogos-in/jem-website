#!/usr/bin/env python3
"""Convert the JEM incident log (.xlsx) into the tracker's incidents.json.

Reads the workbook with the stdlib only (no openpyxl), normalises the column
names, cleans the free-text description, splits the source URLs out of the
source columns, and writes data/incidents.raw.json ready for geocoding.

Usage: python3 scripts/xlsx_to_json.py ../Documents/MAY_26.xlsx
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def col_index(ref):
    """'BC12' -> 54 (0-based column number)."""
    letters = re.match(r"([A-Z]+)", ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall("m:si", NS):
        out.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    return out


def excel_date(serial):
    """Excel serial day number -> ISO date (1900 date system)."""
    try:
        return (datetime(1899, 12, 30) + timedelta(days=float(serial))).date().isoformat()
    except (ValueError, OverflowError):
        return None


def read_sheet(path):
    z = zipfile.ZipFile(path)
    strings = shared_strings(z)
    root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in root.iter(f"{{{NS['m']}}}row"):
        cells = {}
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS)
            t = c.get("t")
            if t == "inlineStr":
                is_el = c.find("m:is", NS)
                val = "".join(x.text or "" for x in is_el.iter(f"{{{NS['m']}}}t")) if is_el is not None else ""
            elif v is None:
                continue
            elif t == "s":
                val = strings[int(v.text)]
            else:
                val = v.text
            cells[col_index(c.get("r"))] = val
        rows.append(cells)
    return rows


# Source workbook headers -> our field names.
HEADER_MAP = {
    "sr. no": "sr_no",
    "reporting date": "date",
    "place": "place",
    "category": "category",
    "minority": "minority",
    "source of information (primary source)": "source_primary",
    "secondary source": "source_secondary",
    "legal status": "legal_status",
    "perpetrator's details": "perpetrator",
    "social and political affiliation": "affiliation",
    "state": "state",
    "jem intervention status": "intervention",
    "jem intervention status final": "intervention_final",
}

URL_RE = re.compile(r"https?://[^\s,]+")

# Spelling/casing drift in the log, collapsed so filters and counts line up.
STATE_FIXES = {
    "Uttarkhand": "Uttarakhand",
    "Uttrakhand": "Uttarakhand",
    "Up": "Uttar Pradesh",
    "Mp": "Madhya Pradesh",
    "Wb": "West Bengal",
    "J&k": "Jammu & Kashmir",
    "Nct Of Delhi": "Delhi",
    "New Delhi": "Delhi",
}
CATEGORY_FIXES = {
    "act of hate": "Act of hate",
    "act of violence": "Act of violence",
    "attacks on religious spaces": "Attacks on religious spaces",
    "police atrocity": "Police atrocity",
    "discrimination,exclusion & prejudice": "Discrimination, exclusion & prejudice",
    "discrimination, exclusion & prejudice": "Discrimination, exclusion & prejudice",
    "state sponsored discrimiatory practice": "State-sponsored discriminatory practice",
    "state sponsored discriminatory practice": "State-sponsored discriminatory practice",
    "media manipulation and distortion of facts": "Media manipulation & distortion of facts",
}
# Entries that name no real place — they stay in the data but off the map.
# Keep in sync with NON_GEO in assets/app.js.
NON_GEOGRAPHIC = {"online", "india", "nationwide", "national", "", "social media",
                  "pan-india", "pan india", "various", "multiple states"}


def norm_header(s):
    return re.sub(r"\s+", " ", (s or "").replace("\r", " ").replace("\n", " ")).strip().lower()


def clean(s):
    if s is None:
        return ""
    s = str(s).replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&#10;", "\n")
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


# Case-insensitive alias lookup, so "UP", "Up" and "up" all fold the same
# way. Keep in sync with STATE_ALIAS_LC in assets/app.js.
STATE_FIXES_LC = {k.lower(): v for k, v in STATE_FIXES.items()}


def title_case_state(s):
    s = clean(s)
    if not s:
        return ""
    alias = STATE_FIXES_LC.get(" ".join(s.split()).lower())
    if alias:
        return alias
    # "Uttar pradesh " -> "Uttar Pradesh"; leave acronyms like "NCT" alone.
    return " ".join(w if w.isupper() else w.capitalize() for w in s.split())


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "../Documents/MAY_26.xlsx")
    out = Path(__file__).resolve().parent.parent / "data" / "incidents.raw.json"

    rows = read_sheet(src)
    if not rows:
        sys.exit("no rows found")

    # The header is not necessarily row 1 — find the row that carries it.
    head_i = next(
        (i for i, r in enumerate(rows) if any(norm_header(v) == "sr. no" for v in r.values())),
        0,
    )
    # A field can span several columns (the sheet repeats 'Primary Source'),
    # so map each field to every column that carries it.
    cols = {}
    for idx, raw in rows[head_i].items():
        key = HEADER_MAP.get(norm_header(raw))
        if key:
            cols.setdefault(key, []).append(idx)

    missing = set(HEADER_MAP.values()) - set(cols)
    if missing:
        print(f"note: columns not found in sheet: {sorted(missing)}", file=sys.stderr)

    # The description sits in the column immediately after 'place' but has no
    # header of its own in this workbook, so take it positionally.
    desc_idx = cols.get("place", [1])[0] + 1
    if desc_idx in {i for v in cols.values() for i in v}:
        desc_idx = None
    rows = rows[head_i + 1:]

    incidents = []
    used_ids = set()
    for r in rows:
        def get(k, _r=r):
            """First non-empty value across every column mapped to this field."""
            for idx in cols.get(k, []):
                v = clean(_r.get(idx))
                if v:
                    return v
            return ""

        def get_all(k, _r=r):
            return [clean(_r.get(idx)) for idx in cols.get(k, []) if clean(_r.get(idx))]

        place = get("place")
        desc = clean(r.get(desc_idx)) if desc_idx is not None else ""
        if not place and not desc:
            continue

        date_raw = next((r.get(i) for i in cols.get("date", []) if r.get(i)), None)
        date = None
        if date_raw is not None:
            s = str(date_raw).strip()
            if re.fullmatch(r"\d+(\.\d+)?", s):
                date = excel_date(s)
            else:
                for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d.%m.%Y", "%d %b %Y", "%d %B %Y"):
                    try:
                        date = datetime.strptime(s, fmt).date().isoformat()
                        break
                    except ValueError:
                        continue

        sources, seen_urls = [], set()
        for field, label in (("source_primary", "Primary"), ("source_secondary", "Secondary")):
            for text in get_all(field):
                urls = URL_RE.findall(text)
                for u in urls:
                    u = u.rstrip(").,")
                    if u not in seen_urls:
                        seen_urls.add(u)
                        sources.append({"kind": label, "url": u})
                if not urls:
                    sources.append({"kind": label, "note": text})

        state = title_case_state(get("state"))
        category = get("category")
        category = CATEGORY_FIXES.get(category.lower(), category)

        # 'Sr. No' restarts with each month block in the log, so it is a
        # reference to print, not a key. The key pairs it with the date and
        # falls back to a counter when that still collides.
        ref = get("sr_no") or str(len(incidents) + 1)
        base = f"{ref}-{date or 'nd'}"
        uid = base
        n = 2
        while uid in used_ids:
            uid = f"{base}-{n}"
            n += 1
        used_ids.add(uid)

        incidents.append({
            "id": uid,
            "ref": ref,
            "date": date,
            "place": place,
            "state": state,
            "geocodable": place.strip().lower() not in NON_GEOGRAPHIC
                          and state.strip().lower() not in NON_GEOGRAPHIC,
            "category": category,
            "minority": get("minority"),
            "description": desc,
            "legal_status": get("legal_status"),
            "perpetrator": get("perpetrator"),
            "affiliation": get("affiliation"),
            "intervention": get("intervention_final") or get("intervention"),
            "sources": sources,
        })

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(incidents, ensure_ascii=False, indent=1))
    print(f"wrote {len(incidents)} incidents -> {out}")

    # quick shape report
    from collections import Counter
    print("categories:", Counter(i["category"] for i in incidents).most_common())
    print("states:", Counter(i["state"] for i in incidents).most_common())
    print("no date:", sum(1 for i in incidents if not i["date"]))


if __name__ == "__main__":
    main()
