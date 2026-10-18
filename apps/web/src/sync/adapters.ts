import { getConversation, listConversations, putConversationFromSync, removeConversationFromSync } from '../chat/store';
import type { Attachment, Conversation, Message } from '../chat/types';
import type { Storage } from './kinds';
import type { WireAttachment, WireChat, WireMessage } from './wire';

/**
 * The web app's chats in and out of the wire format (wire.ts). Going out,
 * attached files shrink to their names; coming in, a message keeps the files
 * this device already has for it.
 */

const present = <T extends object>(object: T): T => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;

function toWireMessage(message: Message): WireMessage {
  const attachments: WireAttachment[] | undefined = message.attachments?.map(({ id, kind, name, width, height }) => present({ id, kind, name, width, height, omitted: true as const }));
  return present({
    id: message.id,
    role: message.role,
    content: message.content,
    reasoning: message.reasoning,
    timestamp: message.timestamp,
    modelId: message.modelId,
    modelName: message.modelName,
    stats: message.stats,
    stopped: message.stopped,
    cloud: message.cloud,
    charged: message.charged,
    attachments,
    x: message.x,
  });
}

export function toWire(conversation: Conversation): WireChat {
  return present({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map(toWireMessage),
    x: conversation.x,
  });
}

export function fromWire(wire: WireChat, local?: Conversation): Conversation {
  const mine = new Map(local?.messages.map(message => [message.id, message]));
  const messages = wire.messages.map((message): Message => {
    // Files stay on the device they were added on: keep this device's copy when it has one.
    const attachments: Attachment[] | undefined = message.attachments?.map(
      (attachment): Attachment => mine.get(message.id)?.attachments?.find(own => own.id === attachment.id && !own.omitted) ?? attachment,
    );
    return present({ ...message, attachments });
  });
  return present({ ...wire, messages });
}

/** The web app's chat database, in wire format. */
export const webChatStorage: Storage<WireChat> = {
  get: async id => {
    const conversation = await getConversation(id);
    return conversation && toWire(conversation);
  },
  put: async wire => putConversationFromSync(fromWire(wire, await getConversation(wire.id))),
  remove: removeConversationFromSync,
  all: async () => (await listConversations()).map(toWire),
};
