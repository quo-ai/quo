/**
 * Reads a server-sent-event response from /api/chat: `event: name` and
 * `data: {json}` lines in blocks separated by a blank line. Calls `onEvent` for
 * each complete block, as it arrives.
 */
export async function readEvents(response: Response, onEvent: (event: string, data: Record<string, unknown>) => void): Promise<void> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let split: number;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !data) continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      onEvent(event, payload);
    }
  }
}
