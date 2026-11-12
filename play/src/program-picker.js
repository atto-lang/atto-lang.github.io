import { readPrograms, saveProgram, deleteProgram } from './saved-programs.js';

/** Keep native editor and built-in samples; user programs are explicitly saved
 * only to this origin's localStorage, never sent to a program service.
 */
export function installProgramPicker({ selector, editor, nameInput, saveButton, deleteButton,
  savedGroup, status, loadSample, onSelectionChange = () => {} }) {
  let currentSelection = 'hello', customMode = false, selectedName = null;
  let cleanSource = '', generation = 0, writingSource = false;
  const tell = message => { status.textContent = message; };
  const storage = () => window.localStorage; // getter may throw: caught at use sites
  const edit = source => {
    writingSource = true;
    try {
      editor.value = source;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      cleanSource = source;
    } finally { writingSource = false; }
  };
  // A delayed sample fetch must never overwrite text entered meanwhile.
  editor.addEventListener('input', () => {
    if (writingSource) return;
    ++generation;
    selector.value = currentSelection; // recover from an abandoned pending selection
    onSelectionChange(false);
  });
  const controls = (enabled, savedName = null) => {
    customMode = enabled;
    selectedName = savedName;
    nameInput.hidden = saveButton.hidden = !enabled;
    deleteButton.hidden = !enabled || savedName === null;
    nameInput.value = savedName || '';
  };
  function refresh(selected = currentSelection) {
    let programs = [];
    try { programs = readPrograms(storage()); }
    catch { tell('Local storage unavailable; saved programs cannot be loaded'); }
    const options = programs.map(({name}) => new Option(name, 'saved:' + name));
    savedGroup.replaceChildren(...options); // text-only options, no HTML parsing
    selector.value = selected;
    return programs;
  }
  async function choose(value, request) {
    if (value === 'custom:new') {
      // Keep the current source when creating a custom copy of a sample.
      controls(true);
      currentSelection = value;
      cleanSource = editor.value;
      tell('Custom draft — name it and click Save');
      return;
    }
    if (value.startsWith('saved:')) {
      const name = value.slice(6), program = refresh(value).find(p => p.name === name);
      if (!program) { tell('Saved program not found in this browser'); return; }
      controls(true, name);
      edit(program.source);
      currentSelection = value;
      tell('Loaded “' + name + '” from this browser');
      return;
    }
    const sample = await loadSample(value);
    if (request !== generation) return; // stale fetch must not overwrite user edits
    controls(false);
    edit(sample);
    currentSelection = value;
    tell('Ready');
  }
  selector.addEventListener('change', async () => {
    const requested = selector.value;
    if (customMode && editor.value !== cleanSource &&
        !window.confirm('This custom program has unsaved changes. Discard them?')) {
      selector.value = currentSelection;
      return;
    }
    const request = ++generation;
    onSelectionChange(true); // clear previous Wasm before the network request
    try { await choose(requested, request); }
    catch (error) {
      if (request !== generation) return; // stale errors cannot affect newer selections
      tell('Cannot load program: ' + error.message);
      selector.value = currentSelection;
    } finally {
      if (request === generation) onSelectionChange(false);
    }
  });
  saveButton.addEventListener('click', () => {
    if (!customMode) return;
    try {
      const all = saveProgram(storage(), nameInput.value, editor.value);
      selectedName = nameInput.value.trim();
      cleanSource = editor.value;
      currentSelection = 'saved:' + selectedName;
      refresh(currentSelection);
      controls(true, selectedName);
      tell('Saved “' + selectedName + '” locally (' + all.length + ' programs)');
    } catch (error) { tell('Save failed: ' + error.message); }
  });
  deleteButton.addEventListener('click', () => {
    if (!selectedName || !window.confirm('Delete local program “' + selectedName + '”?')) return;
    try {
      deleteProgram(storage(), selectedName);
      refresh('custom:new');
      controls(true);
      currentSelection = 'custom:new';
      cleanSource = editor.value; // keep code as an unsaved draft after deletion
      tell('Saved program deleted; current code remains in the editor');
    } catch (error) { tell('Delete failed: ' + error.message); }
  });
  refresh();
  return {
    async initialize(sharedCode = null) {
      if (sharedCode !== null) {
        controls(false);
        edit(sharedCode);
        currentSelection = 'hello';
        onSelectionChange();
        return;
      }
      const request = ++generation;
      onSelectionChange(true);
      try { await choose('hello', request); }
      finally { if (request === generation) onSelectionChange(false); }
    }
  };
}
