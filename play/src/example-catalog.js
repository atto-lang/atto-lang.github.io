// Single source of truth for the playground's built-in sample selector.
// Preview entries are illustrative language designs, not executable with the
// pinned browser compiler. Never silently run a preview against that compiler.
export const EXAMPLES = Object.freeze([
  { id: 'hello', label: 'Hello, functions', runnable: true },
  { id: 'fib', label: 'Recursion', runnable: true },
  { id: 'primes', label: 'Loops', runnable: true },
  { id: 'conditions', label: 'Conditions (named gates)', runnable: true },
  { id: 'overflow', label: 'Checked overflow', runnable: true },
  { id: 'error', label: 'Compiler error', runnable: true },
  { id: 'classes', label: 'Classes', runnable: true },
  { id: 'actors', label: 'Actors (Web Workers)', runnable: true },
  { id: 'enums', label: 'Enums', runnable: true },
  { id: 'generators', label: 'Generators / yield', runnable: false },
  { id: 'async-iterators', label: 'Async generators / for await', runnable: false },
  { id: 'async-tasks', label: 'Tasks / suspend / await', runnable: false },
  { id: 'match-is', label: 'Match types / is / values', runnable: false },
  { id: 'use-using-with', label: 'use / using / with', runnable: false },
  { id: 'functional-pipeline', label: 'Function pipeline |>', runnable: false },
  { id: 'actor-pipeline', label: 'Three-actor pipe', runnable: false },
  { id: 'supervisor-ping-pong', label: 'Supervisor ping-pong channels', runnable: false },
  { id: 'logic-operators', label: 'Logical && / || / ^^ / gates', runnable: false },
].map(item => Object.freeze(item)));

export function exampleById(id) {
  return EXAMPLES.find(sample => sample.id === id) || null;
}
