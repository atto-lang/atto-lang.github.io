/** State guest ABI v2: all three lifecycle hooks must be present together.
 * Imports alone do not authenticate a compiler artifact: the capability is
 * restricted to one disposable, bounded Worker-local guest instance.
 * Actor and pipeline modules have different lifetime / supervision semantics.
 */
const STATE_HOOKS = new Set(['state_register', 'state_enter', 'state_leave']);
const ACTOR_HOOKS = new Set(['actor_spawn', 'actor_send', 'actor_link', 'actor_emit']);

export function stateGuestProfile(module, { actorTypes = 0, pipeline = false } = {}) {
  if (!(module instanceof WebAssembly.Module)) {
    throw new TypeError('E_STATE_ABI: compiled guest module required');
  }
  const imports = WebAssembly.Module.imports(module);
  const hooks = imports.filter(i => i.module === 'atto' && STATE_HOOKS.has(i.name));
  if (!hooks.length) return false;
  if (actorTypes !== 0 || pipeline || imports.some(i =>
    i.module === 'atto' && ACTOR_HOOKS.has(i.name))) {
    throw new Error('E_STATE_ABI: state imports cannot mix with actor or pipeline capabilities');
  }
  if (hooks.length !== STATE_HOOKS.size ||
      new Set(hooks.map(i => i.name)).size !== STATE_HOOKS.size) {
    throw new Error('E_STATE_ABI: complete state_register/enter/leave lifecycle required');
  }
  return true;
}
