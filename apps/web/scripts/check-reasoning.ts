/**
 * Compares the thinking spec of every cloud model with what OpenRouter says about it today, so the app never offers a level
 * a model lacks or hides one it has. Run it when models are added or updated:  npx tsx scripts/check-reasoning.ts
 * (needs the network; prints a line per difference and exits 1 if there is one).
 */
import { cloudModels } from '../server/cloudModels.js';

const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
type Reasoning = { mandatory?: boolean; default_enabled?: boolean; supported_efforts?: string[]; default_effort?: string };

const response = await fetch('https://openrouter.ai/api/v1/models');
const live = new Map(((await response.json()) as { data: { id: string; reasoning?: Reasoning }[] }).data.map(model => [model.id, model.reasoning]));

let differences = 0;
for (const model of cloudModels()) {
  const remote = live.get(model.id);
  const spec = model.thinking;
  const say = (text: string) => {
    differences++;
    console.log(`${model.id}: ${text}`);
  };
  if (!remote) {
    if (spec) say('we describe thinking, OpenRouter does not');
    continue;
  }
  if (!spec) {
    say('OpenRouter describes thinking, we have none');
    continue;
  }
  const theirs = EFFORTS.filter(effort => (remote.supported_efforts ?? []).includes(effort)); // lowest first, like ours
  if (Boolean(remote.mandatory) !== spec.mandatory) say(`mandatory: ours ${spec.mandatory}, theirs ${Boolean(remote.mandatory)}`);
  if (spec.efforts.join() !== theirs.join()) say(`efforts: ours ${spec.efforts.join('/')}, theirs ${theirs.join('/')}`);
  if ((remote.default_effort ?? undefined) !== spec.default) say(`default effort: ours ${spec.default}, theirs ${remote.default_effort}`);
  if (!remote.mandatory && (remote.supported_efforts ?? []).includes('none') !== (spec.off === 'effort')) say('"none" effort differs');
}
console.log(differences ? `${differences} difference(s): update server/cloudModels.ts` : `All ${cloudModels().length} models match OpenRouter's description.`);
process.exit(differences ? 1 : 0);
