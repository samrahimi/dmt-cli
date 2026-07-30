// Torrent downloading via aria2 (`aria2c`), driven over its JSON-RPC interface.
//
// Why aria2 instead of a pure-JS client: it's a mature, out-of-process download
// engine with correct BitTorrent + magnet support, native resume via .aria2
// control files, DHT/trackers, and seed-while-downloading. Running it in a
// separate process also means its internals can never crash ours.
//
// Behaviour:
//  * We seed while downloading (BitTorrent tit-for-tat, which speeds up the
//    fetch) but stop the instant it completes: `--seed-time=0`. Nothing else is
//    ever seeded.
//  * Downloads resume. aria2 keeps a control file and, with
//    `--check-integrity=true`, hash-verifies whatever is already on disk on
//    startup — so an interrupted transfer continues from where it left off.

import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { humanBytes, humanSpeed, humanDuration } from './util.js';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Fields we ask aria2 for on each poll (keeps RPC payloads small).
const STATUS_KEYS = [
  'gid',
  'status',
  'totalLength',
  'completedLength',
  'downloadSpeed',
  'uploadSpeed',
  'connections',
  'numSeeders',
  'bittorrent',
  'files',
];

function renderBar(progress, width = 20) {
  const filled = Math.round(progress * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}

function randomPort() {
  return 16000 + Math.floor(Math.random() * 40000);
}

function randomSecret() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function rpc(port, secret, method, params = []) {
  const res = await fetch(`http://127.0.0.1:${port}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dmt',
      method,
      params: [`token:${secret}`, ...params],
    }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
  return body.result;
}

// Choose the download that represents the actual content (largest total), so we
// show the file transfer rather than the tiny magnet-metadata fetch.
function pickDownload(active) {
  if (!active || active.length === 0) return null;
  return active
    .slice()
    .sort((a, b) => Number(b.totalLength || 0) - Number(a.totalLength || 0))[0];
}

function progressLine(d) {
  const total = Number(d.totalLength || 0);
  const done = Number(d.completedLength || 0);
  const progress = total ? Math.min(done / total, 1) : 0;
  const dl = Number(d.downloadSpeed || 0);
  const ul = Number(d.uploadSpeed || 0);
  const conn = Number(d.connections || 0);
  const seeds = Number(d.numSeeders || 0);
  const eta = dl > 0 ? (total - done) / dl : Infinity;
  return (
    `${renderBar(progress)} ${(progress * 100).toFixed(1)}%  ` +
    `${humanBytes(done)} / ${humanBytes(total)}  ` +
    `↓ ${humanSpeed(dl)}  ↑ ${humanSpeed(ul)}  ` +
    `peers:${conn} seeds:${seeds}  ` +
    `ETA ${humanDuration(eta)}`
  );
}

function statusName(d, input) {
  if (d?.bittorrent?.info?.name) return d.bittorrent.info.name;
  if (d?.files?.[0]?.path) return basename(d.files[0].path);
  return typeof input === 'string' && !input.startsWith('magnet:') ? basename(input) : 'download';
}

// Download a torrent by id (magnet URI or path to a .torrent file), resuming
// from on-disk state if aria2 exits with an error.
// Options: { out, quiet, maxRetries }. Resolves when the download completes.
export async function download(
  torrentId,
  { out = process.cwd(), quiet = false, maxRetries = 8, downLimit = '500M', upLimit = '50M' } = {}
) {
  let retries = 0;
  for (;;) {
    const startedAt = Date.now();
    try {
      return await attemptDownload(torrentId, {
        out,
        quiet,
        downLimit,
        upLimit,
        resuming: retries > 0,
      });
    } catch (err) {
      // aria2 missing / bad usage — not resumable.
      if (err.fatal) throw err;
      // A run that survived a while before failing was healthy; refund the
      // retry budget so transient errors over a long download don't exhaust it.
      if (Date.now() - startedAt > 30000) retries = 0;
      if (retries >= maxRetries) {
        throw new Error(`download failed after ${retries + 1} attempt(s): ${err.message}`);
      }
      retries++;
      const wait = Math.min(2000 * retries, 15000);
      process.stderr.write(
        `\n⚠ Download interrupted: ${err.message}\n` +
          `  Resuming from on-disk data (attempt ${retries + 1}/${maxRetries + 1}) in ${Math.round(
            wait / 1000
          )}s…\n`
      );
      await delay(wait);
    }
  }
}

// One aria2c run. Resolves when aria2 exits 0 (download complete); rejects with a
// resumable error on non-zero exit, or a fatal error if aria2c can't be run.
function attemptDownload(input, { out, quiet, resuming, downLimit = '500M', upLimit = '50M' }) {
  return new Promise((resolve, reject) => {
    const port = randomPort();
    const secret = randomSecret();
    const isTTY = process.stderr.isTTY;
    let ticker = null;
    let lineActive = false;
    let settled = false;
    let last = null;
    let stderrTail = '';

    const args = [
      '--enable-rpc',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${port}`,
      `--rpc-secret=${secret}`,
      `--dir=${out}`,
      '--seed-time=0', // seed while fetching, stop the moment it completes (minutes)
      '--continue=true',
      '--check-integrity=true', // verify on-disk data on start → correct resume
      '--auto-file-renaming=false',
      '--summary-interval=0', // we render our own progress
      '--console-log-level=warn',

      // --- BitTorrent performance --------------------------------------------
      // aria2's defaults are conservative and cap real-world BT throughput well
      // below the line rate. The big one is bt-request-peer-speed-limit: at its
      // 50K default, aria2 stops seeking more peers once you're barely moving.
      // Raising it (plus the peer cap) lets aria2 keep pulling in peers.
      '--bt-request-peer-speed-limit=50M',
      '--bt-max-peers=200',
      '--enable-dht=true',
      '--enable-peer-exchange=true', // PEX — discover peers other peers know about
      '--bt-enable-lpd=true', // local peer discovery
      '--listen-port=6881-6899', // accept incoming peers (lets leechers pull from us)
      '--dht-listen-port=6881-6899',
      '--file-allocation=none', // don't stall at start pre-allocating the file
      `--max-overall-download-limit=${downLimit}`, // 0 = unlimited
      `--max-overall-upload-limit=${upLimit}`, // 0 = unlimited
      input,
    ];

    const child = spawn('aria2c', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    function clearLine() {
      if (lineActive && isTTY) process.stderr.write('\r\x1b[K');
      lineActive = false;
    }

    function render(d) {
      if (quiet) return;
      const line = progressLine(d);
      if (isTTY) {
        process.stderr.write(`\r\x1b[K${line}`);
        lineActive = true;
      } else {
        process.stderr.write(`${line}\n`);
      }
    }

    function finish(fn) {
      if (settled) return;
      settled = true;
      if (ticker) clearInterval(ticker);
      clearLine();
      try {
        if (!child.killed) child.kill();
      } catch {
        /* ignore */
      }
      fn();
    }

    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    child.on('error', (err) => {
      const fatal = new Error(
        err.code === 'ENOENT'
          ? 'aria2c is not installed. Install it (macOS: `brew install aria2`, Debian/Ubuntu: `apt install aria2`).'
          : `failed to start aria2c: ${err.message}`
      );
      fatal.fatal = true;
      finish(() => reject(fatal));
    });

    child.on('exit', (code) => {
      if (code === 0) {
        finish(() =>
          resolve({
            name: statusName(last, input),
            size: Number(last?.totalLength || 0),
            path: out,
          })
        );
      } else {
        const detail =
          stderrTail.trim().split('\n').filter(Boolean).pop() || `aria2c exited with code ${code}`;
        finish(() => reject(new Error(detail)));
      }
    });

    if (!quiet) {
      process.stderr.write(resuming ? 'Verifying existing data…\n' : 'Resolving metadata…\n');
    }

    // Poll aria2 for progress once a second. RPC may refuse connections until
    // aria2 has bound the port — those early failures are ignored.
    ticker = setInterval(async () => {
      try {
        const active = await rpc(port, secret, 'aria2.tellActive', [STATUS_KEYS]);
        const d = pickDownload(active);
        if (d) {
          last = d;
          render(d);
        }
      } catch {
        /* aria2 not ready yet, or a transient RPC hiccup */
      }
    }, 1000);
  });
}
