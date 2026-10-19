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

// "Build me a todo app", "create a website for my bakery", "make a Python script that...": something new to write into files.
const MAKE = /(^|[.!?]\s+|\b(please|can you|could you|would you|i want you to|i need you to|let'?s|lets|go ahead and)\s+)(build|create|make|write|generate|scaffold|set up|code|develop|program)\s+(me\s+|us\s+)?(a|an|the|my|some)?\s*(new\s+|simple\s+|small\s+|basic\s+|full[- ]stack\s+|complete\s+|little\s+)*([\w.+#-]+\s+){0,3}?(app|application|website|web ?site|web app|site|landing page|game|project|cli|command[- ]line tool|tool|bot|extension|plugin|api|server|backend|frontend|script|program|dashboard|calculator|clone|prototype|library|package|component|page|service|scraper|crawler|extension)\b/i;
const QUESTION = /^\s*(how|what|why|when|where|which|who|can i|should i|is it|are there|do i|does)\b/i;

/** Whether a message asks Quo to make something new (with no project mentioned): it gets a fresh folder of its own. */
export function looksLikeNewProjectRequest(text: string): boolean {
  const message = text.trim();
  return message.length >= 10 && !QUESTION.test(message) && MAKE.test(message);
}

export function looksLikeProjectRequest(text: string): boolean {
  const message = text.trim();
  if (message.length < 6) return false;
  return MENTION.test(message) || PATH.test(message) || PROJECT_FILES.test(message) || MY_PROJECT.test(message) || IN_PROJECT.test(message) || DO_IN_PROJECT.test(message) || GIT.test(message);
}
