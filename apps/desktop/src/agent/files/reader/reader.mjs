// In the hidden document reader window: takes a document's bytes from main (through the preload), answers with its text.
// One at a time, in order.
import { extractText } from './extract.mjs';

let queue = Promise.resolve();
window.quoReader.onRequest(({ id, kind, bytes }) => {
  queue = queue.then(() => extractText(kind, bytes).then(text => window.quoReader.reply(id, { text }), error => window.quoReader.reply(id, { error: String(error?.message ?? error) })));
});
window.quoReader.ready();
