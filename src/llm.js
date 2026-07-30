// LLM-based selection of the best torrent for a query, used by headless mode.
// Calls models through the OpenRouter gateway using the OpenAI-compatible
// chat-completions API.

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.DMT_MODEL || 'anthropic/claude-sonnet-5';

const JSON_SCHEMA = {
  name: 'torrent_choice',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      selected_index: {
        type: ['integer', 'null'],
        description:
          'Zero-based index of the chosen result, or null if none are satisfactory.',
      },
      reason: {
        type: 'string',
        description: 'One concise sentence explaining the choice or the refusal.',
      },
    },
    required: ['selected_index', 'reason'],
    additionalProperties: false,
  },
};

function buildPrompt(query, results, hint) {
  const lines = results.map((r, i) => {
    return `[${i}] ${r.name}
    seeders=${r.seeders} leechers=${r.leechers} size=${r.sizeHuman} files=${r.numFiles} uploader=${r.uploader}`;
  });

  return `A user searched for a torrent with this query: "${query}"${
    hint ? `\nThe user prefers this resolution: ${hint}.` : ''
  }

Here are the search results:

${lines.join('\n')}

Pick the single best result that satisfies the user's request. Judge by:
- Correctness: the title must actually match what the user asked for.
- Popularity/health: prefer strong seeder counts (more seeders = faster, more reliable).
- Quality: prefer trustworthy releases and the requested resolution when a hint is given.

If NONE of the results are a satisfactory match for the query (wrong content, all dead with zero seeders, or clearly spam/fake), return null for selected_index and explain why in the reason.

Respond with the zero-based index of your choice (or null) and a one-sentence reason.`;
}

// Returns { index: number|null, reason: string }. index is null on refusal.
export async function pickBest(query, results, hint) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set — headless selection needs an OpenRouter API key.'
    );
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Optional attribution headers recognised by OpenRouter.
      'X-Title': 'dmt',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(query, results, hint) }],
      max_tokens: 1024,
      response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return { index: null, reason: 'Empty response from the model.' };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { index: null, reason: 'Could not parse the model response.' };
  }

  let index = parsed.selected_index;
  if (index === null || index === undefined) {
    return { index: null, reason: parsed.reason || 'No satisfactory result found.' };
  }
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || index >= results.length) {
    return { index: null, reason: 'The model returned an out-of-range choice.' };
  }
  return { index, reason: parsed.reason || 'Best match for the query.' };
}
