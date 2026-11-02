/**
 * A user message that carries images: text and image parts, in OpenAI's chat format, which the cloud server passes to
 * OpenRouter as it is and the other routes convert (Anthropic's blocks, Claude Code's). Images are JPEGs the app made
 * from the person's photo (src/attachments.ts: at most 1024 pixels a side), sent as data addresses. Documents travel as
 * text inside the message, so there is no file part.
 */

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type MessageContent = string | ContentPart[];

/** The text of a message, whatever its shape. */
export const textOfContent = (content: MessageContent): string =>
  typeof content === 'string' ? content : content.map(part => (part.type === 'text' ? part.text : '')).join('\n').trim();

/** The images in a message. */
export const imagesOf = (content: MessageContent): string[] =>
  typeof content === 'string' ? [] : content.flatMap(part => (part.type === 'image_url' ? [part.image_url.url] : []));

/** An image as the app sends it: a data address of a JPEG, PNG, WebP or GIF, nothing else (never a web address). */
export const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Largest image accepted, as a data address (a 1024-pixel JPEG is far smaller). */
export const MAX_IMAGE_CHARS = 1_500_000;
/** Images sent with one request to a model in the cloud: the newest ones (src/chat/context.ts drops older ones). */
export const MAX_REMOTE_IMAGES = 4;
/** What one image costs a model's context, roughly, for estimates and credit holds. */
export const IMAGE_TOKENS = 1600;
