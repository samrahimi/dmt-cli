# dmt

A lightweight, blazingly fast BitTorrent client and torrent search tool for the
terminal. Search, pick, and download — interactively or fully unattended.

## Install

```bash
npm install
npm link        # makes `dmt` available on your PATH
```

Requires **Node.js ≥ 20** and the **aria2** downloader (`aria2c`) on your PATH:

```bash
# macOS
brew install aria2
# Debian / Ubuntu
sudo apt install aria2
```

The actual torrent transfer is handled by aria2, a mature out-of-process engine
with correct magnet/BitTorrent support and reliable resume.

## Usage

```
dmt                          # interactive TUI: type a query, pick a result, download
dmt "some cool movie"        # interactive TUI, prefilled with the query
dmt ./file.torrent           # download a .torrent file, then exit
dmt "magnet:?xt=urn:btih:…"  # download a magnet link, then exit
dmt "some cool movie" --headless --1080p   # unattended: LLM picks the best result
```

### Options

| Option | Description |
| --- | --- |
| `--headless` | Run unattended. No prompts. Exit `0` on success, `1` on failure. |
| `-o, --out <dir>` | Download directory (default: current directory). |
| `--down-limit <rate>` | Cap download speed, e.g. `5M`, `500K` (default: `500M`; `0` = unlimited). |
| `--up-limit <rate>` | Cap upload speed, e.g. `1M` (default: `1M`; `0` = unlimited). |
| `--1080p` / `--720p` / `--4k` | Resolution preference hint for headless LLM selection. |
| `-V, --version` | Print version. |
| `-h, --help` | Show help. |

### Headless mode

`dmt "query" --headless` searches, then asks an LLM to choose the single best
result based on seeders/leechers, title correctness, and quality (plus your
resolution hint if given). If nothing is satisfactory it exits `1`; otherwise it
downloads and exits `0`. Output is intentionally concise.

Headless *search* needs an OpenRouter API key:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

Downloading a magnet or `.torrent` directly needs no API key.

Set `DMT_MODEL` to change the selection model (default `anthropic/claude-sonnet-5`).

## How it works

- **Search** — the [apibay](https://apibay.org) (The Pirate Bay) JSON API.
- **Selection** — an LLM via the [OpenRouter](https://openrouter.ai) gateway
  (OpenAI-compatible chat completions) with structured JSON output.
- **Download** — [aria2](https://aria2.github.io) (`aria2c`), driven over its
  JSON-RPC interface, with DHT + public trackers. Live progress (bytes,
  peers/seeds, up/down speed, ETA) is shown while downloading. We seed the
  content back to the swarm as we fetch it (nothing else, and only until the
  download completes), which speeds up the fetch. If a transfer is interrupted it
  resumes from the data already verified on disk.

See [SKILL.md](./SKILL.md) for agent-oriented usage.

## Legal

This tool downloads whatever you point it at. Only download content you are
legally entitled to (public-domain films, Linux ISOs, Creative Commons media,
your own files, etc.). You are responsible for complying with the law in your
jurisdiction.
