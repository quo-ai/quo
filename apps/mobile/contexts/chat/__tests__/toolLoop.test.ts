import { runToolLoop, MAX_TOOL_ITERATIONS } from '../toolLoop';
import { llmService } from '@/services/llm';
import { AppSettings, Message } from '@/types/chat';

jest.mock('@/services/llm', () => ({
  llmService: { generate: jest.fn() },
}));

const mockedGenerate = llmService.generate as jest.Mock;

function scriptResponses(texts: string[]) {
  mockedGenerate.mockReset();
  for (const text of texts) {
    mockedGenerate.mockResolvedValueOnce({ text, stats: undefined, continuationRounds: 0 });
  }
}

function makeParams() {
  return {
    llmMessages: [
      { id: 'u1', role: 'user', content: 'what day is it?', timestamp: 1 } as Message,
    ],
    settings: {} as AppSettings,
    isPremium: false,
    onMemoryLimit: jest.fn(),
    isCancelled: () => false,
    onStreamUpdate: jest.fn(),
  };
}

describe('runToolLoop info-tool dedup guard', () => {
  it('exits after one duplicates-only feedback round instead of burning all iterations', async () => {
    // Round 1: uses get_date (executed). Rounds 2+: repeats it with short text.
    scriptResponses([
      '[TOOL: get_date()]',
      '[TOOL: get_date()] hm',
      '[TOOL: get_date()] It is Thursday.',
    ]);

    const result = await runToolLoop(makeParams());

    expect(result.cancelled).toBe(false);
    // Round 3 is the second consecutive duplicates-only round: loop must
    // stop there and surface the visible text, not the canned limit line.
    expect(result.finalResponse).toBe('It is Thursday.');
    expect(mockedGenerate).toHaveBeenCalledTimes(3);
    // The duplicate is chipped once, not once per round.
    const dupChips = result.toolActions.filter(a => a.result === 'Already checked this generation');
    expect(dupChips).toHaveLength(1);
  });

  it('falls back to the limit message when duplicates-only rounds have no visible text', async () => {
    scriptResponses(['[TOOL: get_date()]', '[TOOL: get_date()]', '[TOOL: get_date()]']);

    const result = await runToolLoop(makeParams());

    expect(result.finalResponse).toBe('I executed the tools but reached the iteration limit.');
    expect(mockedGenerate).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS);
  });

  it('leaves the normal tool-then-answer flow unchanged', async () => {
    scriptResponses([
      '[TOOL: get_date()]',
      'Today is Thursday, September 10th. Anything else?',
    ]);

    const result = await runToolLoop(makeParams());

    expect(result.finalResponse).toBe('Today is Thursday, September 10th. Anything else?');
    expect(mockedGenerate).toHaveBeenCalledTimes(2);
    expect(result.toolActions.some(a => a.name === 'get_date' && a.result !== 'Already checked this generation')).toBe(true);
  });
});

describe('runToolLoop streaming', () => {
  it('forwards full-text updates (not deltas) and strips tool markers once seen', async () => {
    mockedGenerate.mockReset();
    mockedGenerate.mockImplementationOnce(async (_m: unknown, _s: unknown, onStream: (t: string, d: boolean) => void) => {
      onStream('Hello', false);
      onStream('Hello there', false);
      onStream('Hello there [TOOL:get_date()]', false);
      onStream('', true);
      return { text: 'Hello there, a longer reply that needs no follow up. [TOOL:get_date()]', continuationRounds: 0 };
    });
    const params = makeParams();
    await runToolLoop(params);
    expect(params.onStreamUpdate.mock.calls.map(c => c[0])).toEqual(['Hello', 'Hello there', 'Hello there']);
  });

  it('ignores stream updates after the generation was cancelled', async () => {
    mockedGenerate.mockReset();
    let cancelled = false;
    mockedGenerate.mockImplementationOnce(async (_m: unknown, _s: unknown, onStream: (t: string, d: boolean) => void) => {
      onStream('stale', false);
      cancelled = true;
      onStream('stale text', false);
      return { text: 'stale text', continuationRounds: 0 };
    });
    const params = { ...makeParams(), isCancelled: () => cancelled };
    await runToolLoop(params);
    expect(params.onStreamUpdate.mock.calls.map(c => c[0])).toEqual(['stale']);
  });

  it('reports a dead native context with the partial text', async () => {
    mockedGenerate.mockReset();
    mockedGenerate.mockResolvedValueOnce({ text: 'partial', continuationRounds: 0, modelUnloaded: true });
    const result = await runToolLoop(makeParams());
    expect(result).toMatchObject({ cancelled: false, modelUnloaded: true, finalResponse: 'partial' });
  });
});

describe('runToolLoop cancellation', () => {
  it('does not execute tool calls when the generation was stopped', async () => {
    mockedGenerate.mockReset();
    let cancelled = false;
    mockedGenerate.mockImplementationOnce(async () => {
      cancelled = true;
      return { text: '[TOOL:get_date()]', continuationRounds: 0 };
    });
    const result = await runToolLoop({ ...makeParams(), isCancelled: () => cancelled });
    expect(result.cancelled).toBe(true);
    expect(result.toolActions).toEqual([]);
  });
});

describe('runToolLoop reasoning safety', () => {
  it('ignores tool calls that only appear inside the reasoning block', async () => {
    mockedGenerate.mockReset();
    mockedGenerate.mockResolvedValueOnce({
      text: '<think>Maybe I should [TOOL:save_memory(content="x")]</think>Here is a long enough answer without tools.',
      continuationRounds: 0,
    });
    const result = await runToolLoop(makeParams());
    expect(result.toolActions).toEqual([]);
  });
});
