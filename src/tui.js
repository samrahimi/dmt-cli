// Interactive terminal UI: search → pick → download.

import { input, select } from '@inquirer/prompts';
import { search } from './search.js';
import { download } from './download.js';

function resultLabel(r) {
  const health = `S:${r.seeders} L:${r.leechers}`;
  return `${r.name}  ·  ${r.sizeHuman}  ·  ${health}  ·  ${r.uploader}`;
}

// Run the interactive flow. If initialQuery is given, the first search runs
// immediately; otherwise the user is prompted for a query.
export async function runTui({ initialQuery, out, downLimit = '500M', upLimit = '50M' } = {}) {
  let query = initialQuery;

  while (true) {
    if (!query) {
      query = await input({ message: 'Search torrents:' });
    }
    if (!query || !query.trim()) {
      console.log('Nothing to search for. Bye.');
      return 0;
    }

    process.stderr.write(`Searching for "${query}"…\n`);
    let results;
    try {
      results = await search(query);
    } catch (err) {
      console.error(`Search failed: ${err.message}`);
      query = undefined;
      continue;
    }

    if (results.length === 0) {
      console.log('No results found.');
      query = undefined;
      continue;
    }

    const choices = results.slice(0, 40).map((r, i) => ({
      name: resultLabel(r),
      value: i,
    }));
    choices.push({ name: '↻ New search', value: 'search' });
    choices.push({ name: '✗ Quit', value: 'quit' });

    const picked = await select({
      message: `${results.length} result(s) — choose one to download:`,
      choices,
      pageSize: 15,
    });

    if (picked === 'quit') return 0;
    if (picked === 'search') {
      query = undefined;
      continue;
    }

    const chosen = results[picked];
    try {
      const done = await download(chosen.magnet, { out, downLimit, upLimit });
      console.log(`\n✓ Downloaded "${done.name}" to ${done.path}`);
      return 0;
    } catch (err) {
      console.error(`\nDownload failed: ${err.message}`);
      return 1;
    }
  }
}
