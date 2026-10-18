import type { LocalModel } from './catalog';
import type { CloudModel } from './cloud/catalog';

/** The model a chat runs on: in the browser, or in the cloud via Quo's API. */
export type ModelChoice =
  | { kind: 'local'; model: LocalModel }
  | { kind: 'cloud'; model: CloudModel };

export const choiceKey = (choice: ModelChoice): string => `${choice.kind}:${choice.model.id}`;

/** Context budget for cloud models (they accept far more; this keeps cost per message sane). */
export const CLOUD_CONTEXT = { contextSize: 32_768, maxTokens: 4_096 };
