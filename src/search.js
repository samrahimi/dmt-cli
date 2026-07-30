// Torrent search via the apibay (The Pirate Bay) JSON API.

import { humanBytes, magnetFromHash } from './util.js';

const API = 'https://apibay.org/q.php';

// Search for torrents matching a query. Returns a normalised array of results
// sorted by seeders (most healthy first).
export async function search(query, { signal } = {}) {
  const url = `${API}?q=${encodeURIComponent(query)}&cat=0`;
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'dmt/1.0' },
  });
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`);
  const raw = await res.json();

  // apibay returns a single-element array with id "0" and name
  // "No results returned" when nothing matches.
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (raw.length === 1 && raw[0].id === '0') return [];

  return raw
    .map((r) => {
      const seeders = Number(r.seeders) || 0;
      const leechers = Number(r.leechers) || 0;
      const size = Number(r.size) || 0;
      return {
        name: r.name,
        infoHash: r.info_hash,
        seeders,
        leechers,
        size,
        sizeHuman: humanBytes(size),
        numFiles: Number(r.num_files) || 0,
        uploader: r.username || 'anon',
        added: Number(r.added) || 0,
        magnet: magnetFromHash(r.info_hash, r.name),
      };
    })
    .sort((a, b) => b.seeders - a.seeders);
}
