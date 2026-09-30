![smart notes — Notes, Journal, Calendar](docs/assets/smart-notes-hero.png)

# smart notes

A local-first notebook for notes, journals, and daily plans, with a calendar-first view and optional AI conversations.

Built with **Next.js, FastAPI, SQLite, and pywebview**. The interface is in Simplified Chinese; the desktop app has been tested on macOS.

## Features

- **Notes:** organize by category and date, and insert, paste, or drag in images.
- **Journaling:** right-click any calendar date to write an entry, including past days. Pink outlines mark journal dates; double-click to read.
- **Planning:** manage daily items with times, completion states, and color-coded tags.
- **AI:** discuss a note in a side panel or chat with Strawberry. Desktop and web conversations are saved locally.
- **CLI:** create, browse, and search notes from your terminal.

## Quick start

Requires **Python 3.9+**, **Node.js 20.9+**, npm, and Git. Use a macOS/Linux shell:

```bash
git clone https://github.com/ziyu1617/pf-notes.git smart-notes
cd smart-notes

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm ci --prefix frontend

cd frontend
NEXT_OUTPUT=export npm run build
cd ..
python app.py
```

The app opens a native window and serves the interface at `http://127.0.0.1:8000`. Rebuild after frontend changes, then reopen the app.

For browser-only use, replace `python app.py` with:

```bash
python -m uvicorn api:app --host 127.0.0.1 --port 8000
```

## Optional AI

Copy `.env.example` to `.env`, set `ZHIPU_API_KEY=your_api_key_here`, and restart the app. The default provider is Zhipu, using `GLM-5.1`.

Notes and calendar features work without a key. AI requires internet access and sends relevant note text and conversation context to the provider; Strawberry sends its chat context.

## Local data

- Database: `~/.smart_notes.db`
- Note images: `~/.smart_notes_uploads/`

Close the app and copy both locations to back up your content. Core features work offline after setup; there is no built-in cloud sync.

## CLI

With the virtual environment active:

```bash
./notes list
./notes search "keyword"
./notes --help
```
