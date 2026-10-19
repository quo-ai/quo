/**
 * Whether a message is about the person's own project, so Quo can start working in their folder without being asked to
 * turn anything on. Deliberately narrow: it looks for the person pointing at their project (a file, a path, "my repo",
 * "run the tests"), not for anything that merely mentions code, so "write a function that reverses a string" or a pasted
 * snippet stay ordinary chat. A miss costs one click on the folder button; a false hit would read files nobody asked about.
 */

const MENTION = /(^|\s)@[\w.-]+(\/[\w.-]+)*/;
// A path with a folder in it and an extension, or a file that only ever means a project ("package.json", not "next.js").
const PATH = /(^|[\s("'`])\.{0,2}\/?[\w.-]+\/[\w./-]*\.[A-Za-z0-9]{1,8}\b/;
const PROJECT_FILES = /\b(package\.json|package-lock\.json|tsconfig\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|pom\.xml|build\.gradle|dockerfile|docker-compose\.ya?ml|makefile|readme\.md|\.gitignore|\.env)\b/i;
const MY_PROJECT = /\b(my|our|this|the|that)\s+(project|repo|repository|codebase|code base|source code|source tree|workspace|working directory)\b/i;
const IN_PROJECT = /\b(in|across|through|inside|from)\s+(the\s+)?(codebase|code base|repo|repository|project|source)\b/i;
// An instruction ("run the tests", "can you run the build"), not a question about how ("how do I run tests").
const DO_IN_PROJECT = /(^|[.!?,]\s+|\b(please|then|and|can you|could you|would you|go)\s+)(run|rerun|re-run|execute|start)\s+(the\s+|my\s+|our\s+)?(unit\s+|integration\s+)?(tests?|test suite|build|linter?|typecheck|type check|dev server|migrations?)\b/i;
const GIT = /\bgit\s+(status|diff|log|blame|commit|branch|stash|rebase|merge)\b/i;

export function looksLikeProjectRequest(text: string): boolean {
  const message = text.trim();
  if (message.length < 6) return false;
  return MENTION.test(message) || PATH.test(message) || PROJECT_FILES.test(message) || MY_PROJECT.test(message) || IN_PROJECT.test(message) || DO_IN_PROJECT.test(message) || GIT.test(message);
}
