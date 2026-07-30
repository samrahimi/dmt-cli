---
name: dmt
description: Search for and download torrents from the terminal. Use when the user wants to find or download a torrent, movie, TV show, album, software, or any content available via BitTorrent, or when given a magnet link or .torrent file to download. Provides an unattended headless mode designed for agent use.
---

# dmt — terminal torrent search & download

`dmt` searches for torrents, downloads via magnet link or `.torrent` file, and
(in headless mode) uses an LLM to automatically pick the best result for a query.

## When to use

- The user asks to download a movie / show / album / software / dataset available as a torrent.
- The user provides a magnet link or a `.torrent` file path.
- The user asks to search for torrents.

## Headless mode (use this — it's designed for agents)

Add `--headless` to run fully unattended. Output is concise (a few lines), and
the process exits with a meaningful status code.

```
dmt "QUERY" --headless [--1080p | --720p | --4k] [--out DIR]
```

- Searches for `QUERY`, then an LLM selects the single best result by seeders,
  title correctness, and quality. If a resolution flag is given, the LLM is told
  the user's preferred resolution.
- If no result is satisfactory, it prints the reason to stderr and **exits 1**.
- On success it downloads the file and **exits 0**.

**Exit codes:** `0` = downloaded successfully. `1` = no suitable result, search
failed, selection failed, or download failed. Always check the exit code.

**Requirements:** headless *search* mode needs `OPENROUTER_API_KEY` in the
environment (used for LLM selection). Downloading a magnet/`.torrent` directly
needs no API key.

### Examples

```bash
# Find and download a movie in 1080p, unattended:
dmt "the matrix 1999" --headless --1080p

# Download into a specific directory:
dmt "ubuntu 24.04 desktop" --headless --out ~/Downloads

# Download a known magnet link (no API key or search needed):
dmt "magnet:?xt=urn:btih:..." --headless

# Download a local .torrent file:
dmt ./file.torrent --headless
```

### Interpreting output

Success (stdout):
```
Selected: The Matrix (1999) 1080p BluRay x264
Reason: Highest seeder count with a matching 1080p release.
Health: 1240 seeders / 88 leechers · 2.1 GB
OK The Matrix (1999) 1080p BluRay x264 (2.1 GB) -> /home/user/Downloads
```

Failure (stderr, exit 1):
```
No suitable result: none of the results match the requested title.
```

## Interactive mode (for humans, not agents)

Running without `--headless` opens a terminal UI:

- `dmt` — prompt for a query, show a selectable result list, download the pick.
- `dmt "QUERY"` — same, but run the search immediately.

Do **not** use interactive mode from an agent — it blocks on keyboard input.

## Requirements

- **`aria2c`** must be installed and on PATH — it performs the download
  (macOS: `brew install aria2`, Debian/Ubuntu: `apt install aria2`). If it's
  missing, `dmt` exits with an error telling you to install it.
- Headless search additionally needs `OPENROUTER_API_KEY` (see above).

## Notes

- Resolution flags (`--1080p`, `--720p`, `--4k`) only affect headless LLM
  selection; they are hints, not hard filters.
- Default download directory is the current working directory; override with `--out`.
- Set `DMT_MODEL` to override the OpenRouter model used for selection
  (default: `anthropic/claude-sonnet-5`).
