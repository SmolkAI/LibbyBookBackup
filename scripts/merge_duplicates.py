#!/usr/bin/env python3
"""Merge duplicate book files (same title+author+format) into single files.

For each group of duplicates:
- Union all highlights (deduplicated by timestamp+quote)
- Union all bookmarks (deduplicated by timestamp)
- Keep the most complete circulation history
- Keep highest reading progress
- Use the OLDEST download date in the merged filename
- Delete redundant files after merging
"""
import json
import os
import re
from collections import defaultdict
from pathlib import Path

BOOKS_DIR = Path("/Users/Shared/projects/2023/LibbyBookBackup/books")


def extract_download_date(filename):
    """Extract the (downloaded YYYY-MM-DD HH-MM) date from filename."""
    m = re.search(r"\(downloaded (\d{4}-\d{2}-\d{2} \d{2}-\d{2})\)", filename)
    return m.group(1) if m else "9999-99-99 99-99"


def merge_group(files_data):
    """Merge a list of (filepath, parsed_json) into one combined JSON.

    Returns (merged_data, keeper_path, paths_to_delete).
    """
    # Sort by download date ascending (oldest first)
    files_data.sort(key=lambda x: extract_download_date(x[0].name))

    # Start with the oldest file as the base
    base_path, base = files_data[0]

    # Collect all highlights, deduplicated by (timestamp, quote)
    seen_highlights = set()
    all_highlights = []
    for _, data in files_data:
        for hl in data.get("highlights", []):
            key = (hl.get("timestamp"), hl.get("quote", ""))
            if key not in seen_highlights:
                seen_highlights.add(key)
                all_highlights.append(hl)

    # Collect all bookmarks, deduplicated by timestamp
    seen_bookmarks = set()
    all_bookmarks = []
    for _, data in files_data:
        for bm in data.get("bookmarks", []):
            key = bm.get("timestamp")
            if key not in seen_bookmarks:
                seen_bookmarks.add(key)
                all_bookmarks.append(bm)

    # Keep the longest circulation history
    best_circ = max(
        (data.get("circulation", []) for _, data in files_data),
        key=len
    )

    # Keep highest reading progress
    best_percent = max(
        (data["readingJourney"].get("percent", 0) or 0 for _, data in files_data)
    )

    # Build merged result from the oldest file
    merged = dict(base)
    merged["highlights"] = sorted(all_highlights, key=lambda x: x.get("timestamp", 0))
    merged["bookmarks"] = sorted(all_bookmarks, key=lambda x: x.get("timestamp", 0))
    merged["circulation"] = best_circ
    if best_percent:
        merged["readingJourney"]["percent"] = best_percent

    # The keeper filename uses the oldest download date (base_path)
    keeper_path = base_path
    paths_to_delete = [p for p, _ in files_data if p != keeper_path]

    return merged, keeper_path, paths_to_delete


def main():
    # Group files by (title, author, format)
    groups = defaultdict(list)
    for f in sorted(BOOKS_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            rj = data["readingJourney"]
            key = (rj["title"]["text"], rj["author"], rj["cover"]["format"])
            groups[key].append((f, data))
        except Exception as e:
            print(f"SKIP (parse error): {f.name}: {e}")

    total_files = sum(len(v) for v in groups.values())
    dupe_groups = {k: v for k, v in groups.items() if len(v) > 1}

    print(f"Total files: {total_files}")
    print(f"Unique books: {len(groups)}")
    print(f"Groups with duplicates: {len(dupe_groups)}")
    print(f"Files to remove: {sum(len(v) - 1 for v in dupe_groups.values())}")
    print()

    merged_count = 0
    deleted_count = 0

    for (title, author, fmt), files_data in sorted(dupe_groups.items()):
        merged, keeper_path, to_delete = merge_group(files_data)

        # Count merged stats
        orig_hl = max(len(d.get("highlights", [])) for _, d in files_data)
        orig_bm = max(len(d.get("bookmarks", [])) for _, d in files_data)
        new_hl = len(merged.get("highlights", []))
        new_bm = len(merged.get("bookmarks", []))

        # Write merged data to keeper file
        with open(keeper_path, "w") as f:
            json.dump(merged, f, indent=2)

        # Delete redundant files
        for p in to_delete:
            os.remove(p)
            deleted_count += 1

        gained_hl = new_hl - orig_hl
        gained_bm = new_bm - orig_bm
        extra = ""
        if gained_hl > 0 or gained_bm > 0:
            extra = f" (recovered +{gained_hl} hl, +{gained_bm} bm from older files)"

        print(f"  {title} [{fmt}]: {len(files_data)} -> 1 file, {new_hl} hl, {new_bm} bm{extra}")
        merged_count += 1

    print()
    print(f"Merged {merged_count} groups, deleted {deleted_count} redundant files")
    remaining = total_files - deleted_count
    print(f"Remaining: {remaining} files for {len(groups)} unique books")


if __name__ == "__main__":
    main()
