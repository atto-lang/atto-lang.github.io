import { caretPosition, lineNumbers, sourceOffset } from './ui.js';

/** Enhance the native editor without replacing the input used by browser tests
 * and assistive technology. No remote editor scripts or source telemetry. */
export function installEditor(editor, { gutter, cursor, onRun }) {
  const render = () => {
    gutter.textContent = lineNumbers(editor.value);
    gutter.scrollTop = editor.scrollTop;
    const pos = caretPosition(editor.value, editor.selectionStart);
    cursor.textContent = 'Ln ' + pos.line + ', Col ' + pos.column;
  };
  const replace = (start, end, content) => {
    editor.setRangeText(content, start, end, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  editor.addEventListener('input', render);
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
  editor.addEventListener('click', render);
  editor.addEventListener('keyup', render);
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      onRun();
      return;
    }
    if (editor.readOnly || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editor.selectionStart;
      if (event.shiftKey) {
        const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
        const prefix = editor.value.slice(lineStart, lineStart + 2);
        const remove = prefix.startsWith('  ') ? 2 : prefix.startsWith(' ') ? 1 : 0;
        if (remove) replace(lineStart, lineStart + remove, '');
      } else {
        replace(start, editor.selectionEnd, '  ');
      }
    } else if (event.key === 'Enter' && editor.selectionStart === editor.selectionEnd) {
      const start = editor.selectionStart;
      const line = editor.value.slice(editor.value.lastIndexOf('\n', start - 1) + 1, start);
      const indent = /^[ \t]*/.exec(line)[0].slice(0, 40);
      event.preventDefault();
      replace(start, start, '\n' + indent);
    }
  });
  render();
  return (line, column) => {
    const offset = sourceOffset(editor.value, line, column);
    editor.focus();
    editor.setSelectionRange(offset, offset);
    render();
  };
}
