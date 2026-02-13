#!/usr/bin/env python3
"""Scan books/*.json and produce ui/data/index.json for the browsing UI."""

import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = PROJECT_ROOT / "books"
OUTPUT_FILE = PROJECT_ROOT / "ui" / "data" / "index.json"


def parse_book(filepath: Path) -> dict | None:
    try:
        with open(filepath) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  SKIP {filepath.name}: {e}", file=sys.stderr)
        return None

    rj = data.get("readingJourney", {})
    title_obj = rj.get("title", {})
    cover_obj = rj.get("cover", {})
    circulation = data.get("circulation", [])
    highlights = data.get("highlights", [])
    bookmarks = data.get("bookmarks", [])

    # Derive dates from circulation events
    timestamps = [c["timestamp"] for c in circulation if "timestamp" in c]
    first_borrowed = min(timestamps) if timestamps else None
    last_activity = max(timestamps) if timestamps else None

    # Libraries used
    libraries = list(
        {c["library"]["text"] for c in circulation if "library" in c and "text" in c["library"]}
    )

    return {
        "file": filepath.name,
        "titleId": title_obj.get("titleId", ""),
        "title": title_obj.get("text", ""),
        "url": title_obj.get("url", ""),
        "author": rj.get("author", ""),
        "publisher": rj.get("publisher", ""),
        "isbn": rj.get("isbn", ""),
        "format": cover_obj.get("format", ""),
        "coverUrl": cover_obj.get("url", ""),
        "coverColor": cover_obj.get("color", ""),
        "percent": rj.get("percent"),
        "highlightCount": len(highlights),
        "bookmarkCount": len(bookmarks),
        "firstBorrowed": first_borrowed,
        "lastActivity": last_activity,
        "libraries": libraries,
        "circulationCount": len(circulation),
    }


def build_index() -> list[dict]:
    if not BOOKS_DIR.is_dir():
        print(f"Books directory not found: {BOOKS_DIR}", file=sys.stderr)
        sys.exit(1)

    files = sorted(BOOKS_DIR.glob("*.json"))
    print(f"Found {len(files)} book files in {BOOKS_DIR}")

    books = []
    for fp in files:
        entry = parse_book(fp)
        if entry:
            books.append(entry)

    # Deduplicate: keep the most recently downloaded version per titleId
    by_title: dict[str, dict] = {}
    for book in books:
        tid = book["titleId"]
        if not tid:
            by_title[book["file"]] = book
            continue
        existing = by_title.get(tid)
        if existing is None or book["file"] > existing["file"]:
            by_title[tid] = book

    deduped = sorted(by_title.values(), key=lambda b: b.get("lastActivity") or 0, reverse=True)
    print(f"Indexed {len(deduped)} unique books ({len(books) - len(deduped)} duplicates removed)")
    return deduped


def main():
    books = build_index()

    # Compute summary stats
    stats = {
        "totalBooks": len(books),
        "totalHighlights": sum(b["highlightCount"] for b in books),
        "totalBookmarks": sum(b["bookmarkCount"] for b in books),
        "formats": {},
        "libraries": {},
        "topAuthors": {},
    }
    for b in books:
        fmt = b["format"] or "unknown"
        stats["formats"][fmt] = stats["formats"].get(fmt, 0) + 1
        for lib in b["libraries"]:
            stats["libraries"][lib] = stats["libraries"].get(lib, 0) + 1
        author = b["author"]
        if author:
            stats["topAuthors"][author] = stats["topAuthors"].get(author, 0) + 1

    # Sort topAuthors by count descending, keep top 20
    stats["topAuthors"] = dict(
        sorted(stats["topAuthors"].items(), key=lambda x: x[1], reverse=True)[:20]
    )

    index = {"stats": stats, "books": books}

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(index, f, separators=(",", ":"))

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f"Wrote {OUTPUT_FILE} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
