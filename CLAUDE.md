# LibbyBookBackup

## Overview
This project backs up and manages book notes and highlights exported from the Libby (OverDrive) reading app. It includes export scripts, downloaded book data, and tools for processing the data.

## Project Structure
- `books/` — Individual book note JSON files exported from Libby (gitignored, data-only)
- `all_overdrive_books/` — Bulk download chunks of all OverDrive book data (gitignored, data-only)
- `old/` — Earlier versions of book note exports (gitignored, data-only)
- `using_code_interpreter/` — Scripts for exporting and processing data:
  - `export_timeline.py` — Downloads user's Libby timeline (requires browser sign-in)
  - `download_book_json_async.js` / `download_book_json_synchronous.js` — Puppeteer scripts to download book journey JSONs
  - `remove_duplicate_files.py` — Deduplicates files from multiple Puppeteer runs
- `bulk_book_downloader.py` — Downloads all OverDrive books in chunks
- `complete_books_information.json` — Full book metadata export
- `libbytimeline-activities.json` — Libby timeline activity data
- `export_log.txt` — Log of export URLs used

## Goals
1. **Update and fix the export scripts** — Ensure the Libby export and download pipeline works reliably
2. **Build a browsing UI** — Create a web interface to browse, search, and view the book notes and highlights
3. **Data processing** — Clean, reorganize, and improve the exported book data
4. **Dynamic updates** — Support incrementally updating the book list without re-exporting everything

## Tech Stack
- Node.js (Puppeteer for scraping)
- Python (export scripts, data processing)
- The GitHub repo is at github.com/msmolkin/LibbyBookBackup (code only — data files are gitignored)

## Notes
- Book note JSONs contain highlights, bookmarks, and reading progress from Libby
- The `all_overdrive_books/` chunks are large JSON files (~1-5MB each, 210+ files) containing full OverDrive catalog data
- The timeline JSON contains all loan history and activity
