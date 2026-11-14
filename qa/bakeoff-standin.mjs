/* QA stand-in for the bake-off harness (#2235): answers Anthropic and xAI from memory so a run spends nothing and leaves the machine nowhere.
 * QA_STANDIN_MODE = ok (default) | fail (every call answers 500 with QA_STANDIN_SENTINEL in the body, to prove error text is never printed). */
const realFetch = globalThis.fetch;
const SENTINEL = process.env.QA_STANDIN_SENTINEL || 'QA-SENTINEL';
const ANSWER = 'SIGNAL: BULLISH\nCONFIDENCE: 80\nCOUNTED: bullish: 2 (a, b) | bearish 1 (c)\nCATALYSTS:\n- None in input\nCHART_ANALYSIS: higher lows\nREASONING: momentum.';
const j = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  const fail = (process.env.QA_STANDIN_MODE || 'ok') === 'fail';
  if (url.origin === 'https://api.anthropic.com') {
    if (fail) return j(500, { type: 'error', error: { type: 'api_error', message: SENTINEL } });
    const body = JSON.parse(await req.text());
    return j(200, { id: 'msg_qa', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: ANSWER }], usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  }
  if (url.origin === 'https://api.x.ai') {
    if (fail) return j(500, { error: SENTINEL });
    return j(200, { model: 'grok-4.3', choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 300 } });
  }
  throw new Error('stray request to ' + url.host);
};
void realFetch;
