// Shared helpers: formatting, magnet construction, argument classification.

// Public trackers appended to magnet links built from an info hash, so that
// results from the search API (which only give us a hash) are actually usable.
export const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.nl:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
];

export function humanBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function humanSpeed(bytesPerSec) {
  return `${humanBytes(bytesPerSec)}/s`;
}

export function humanDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '∞';
  if (seconds === 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

// Build a magnet URI from an info hash plus a display name and trackers.
//
// Note: the xt parameter must stay literal — `xt=urn:btih:<hash>`. The colons
// are part of the magnet grammar and magnet parsers match them un-decoded, so
// percent-encoding them (as URLSearchParams.toString() would) yields an
// "Invalid torrent identifier". Only the free-text dn value needs encoding.
export function magnetFromHash(infoHash, name) {
  const parts = [`xt=urn:btih:${infoHash}`];
  if (name) parts.push(`dn=${encodeURIComponent(name)}`);
  for (const t of TRACKERS) parts.push(`tr=${encodeURIComponent(t)}`);
  return `magnet:?${parts.join('&')}`;
}

// Decide what a positional argument is: a magnet link, a local .torrent file,
// or a free-text search query.
export function classifyInput(input) {
  if (!input) return { kind: 'empty' };
  const trimmed = input.trim();
  if (/^magnet:\?/i.test(trimmed)) return { kind: 'magnet', value: trimmed };
  // Support the magnet://hash shorthand the user mentioned.
  const shorthand = trimmed.match(/^magnet:\/\/([a-z0-9]+)$/i);
  if (shorthand) return { kind: 'magnet', value: magnetFromHash(shorthand[1]) };
  if (/\.torrent$/i.test(trimmed)) return { kind: 'torrent', value: trimmed };
  return { kind: 'query', value: trimmed };
}

// Map a resolution flag to a human-readable hint for the LLM / search.
export function resolutionHint(opts) {
  if (opts['4k']) return '2160p (4K)';
  if (opts['1080p']) return '1080p';
  if (opts['720p']) return '720p';
  return null;
}
