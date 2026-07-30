#!/usr/bin/env node
// dmt — a lightweight, fast BitTorrent client and torrent search tool.
//
// Modes:
//   dmt                        interactive TUI (prompt for a query)
//   dmt "some query"           interactive TUI, prefilled with the query
//   dmt path/to/file.torrent   download the torrent file, then exit
//   dmt "magnet:?xt=..."       download via magnet link, then exit
//   dmt "query" --headless     unattended: search, let an LLM pick, download
//
// Resolution hints (--1080p / --720p / --4k) are passed to the LLM in
// headless mode to bias selection toward the preferred quality.

import { Command } from 'commander';
import { search } from './search.js';
import { download } from './download.js';
import { runTui } from './tui.js';
import { pickBest } from './llm.js';
import { classifyInput, resolutionHint, humanBytes } from './util.js';

const program = new Command();

program
  .name('dmt')
  .description('Lightweight terminal BitTorrent client and torrent search tool')
  .argument('[input]', 'a search query, a magnet link, or a path to a .torrent file')
  .option('--headless', 'run unattended: no interaction, exit 0 on success / 1 on failure')
  .option('-o, --out <dir>', 'download directory', process.cwd())
  .option('--down-limit <rate>', 'max overall download speed, e.g. 5M or 500K (0 = unlimited)', '500M')
  .option('--up-limit <rate>', 'max overall upload speed, e.g. 1M (0 = unlimited)', '50M')
  .option('--1080p', 'prefer 1080p (headless selection hint)')
  .option('--720p', 'prefer 720p (headless selection hint)')
  .option('--4k', 'prefer 4K/2160p (headless selection hint)')
  .version('1.0.0')
  .action(async (inputArg, opts) => {
    const code = await run(inputArg, opts);
    process.exit(code);
  });

// Common download options derived from CLI flags.
function dlOpts(opts, extra = {}) {
  return { out: opts.out, downLimit: opts.downLimit, upLimit: opts.upLimit, ...extra };
}

async function run(inputArg, opts) {
  const { kind, value } = classifyInput(inputArg);
  const out = opts.out;

  // Direct download: a magnet link or a local .torrent file. Always unattended.
  if (kind === 'magnet' || kind === 'torrent') {
    try {
      const done = await download(value, dlOpts(opts, { quiet: opts.headless }));
      if (opts.headless) {
        console.log(`OK ${done.name} (${humanBytes(done.size)}) -> ${done.path}`);
      } else {
        console.log(`\n✓ Downloaded "${done.name}" to ${done.path}`);
      }
      return 0;
    } catch (err) {
      console.error(`Download failed: ${err.message}`);
      return 1;
    }
  }

  // Query provided.
  if (kind === 'query') {
    if (opts.headless) return headlessSearch(value, opts, out);
    return runTui({ initialQuery: value, ...dlOpts(opts) });
  }

  // No argument.
  if (opts.headless) {
    console.error('Error: --headless requires a query, magnet link, or .torrent path.');
    return 1;
  }
  return runTui({ ...dlOpts(opts) });
}

// Unattended search → LLM pick → download. Exit 1 if the LLM refuses.
async function headlessSearch(query, opts, out) {
  const hint = resolutionHint(opts);

  let results;
  try {
    results = await search(query);
  } catch (err) {
    console.error(`Search failed: ${err.message}`);
    return 1;
  }
  if (results.length === 0) {
    console.error(`No results found for "${query}".`);
    return 1;
  }

  let choice;
  try {
    choice = await pickBest(query, results.slice(0, 30), hint);
  } catch (err) {
    console.error(`Selection failed: ${err.message}`);
    return 1;
  }

  if (choice.index === null) {
    console.error(`No suitable result: ${choice.reason}`);
    return 1;
  }

  const chosen = results[choice.index];
  console.log(`Selected: ${chosen.name}`);
  console.log(`Reason: ${choice.reason}`);
  console.log(`Health: ${chosen.seeders} seeders / ${chosen.leechers} leechers · ${chosen.sizeHuman}`);

  try {
    const done = await download(chosen.magnet, dlOpts(opts, { quiet: true }));
    console.log(`OK ${done.name} (${humanBytes(done.size)}) -> ${done.path}`);
    return 0;
  } catch (err) {
    console.error(`Download failed: ${err.message}`);
    return 1;
  }
}

program.parseAsync(process.argv);
