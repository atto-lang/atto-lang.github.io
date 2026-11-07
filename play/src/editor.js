import { caretPosition, lineNumbers, sourceOffset } from './ui.js';
import { renderHighlighted } from './syntax-highlight.js';

/** Enhance the native editor without replacing the input used by browser tests
 * and assistive technology. No remote editor scripts or source telemetry. */
export function installEditor(editor, { gutter, cursor, onRun, onFormat }) {
  const layer = document.querySelector('#syntax-layer');
  const syncScroll = () => { if (layer) { layer.scrollTop = editor.scrollTop; layer.scrollLeft = editor.scrollLeft; } };
  const render = () => {
    gutter.textContent = lineNumbers(editor.value);
    gutter.scrollTop = editor.scrollTop;
    if (layer) {
      renderHighlighted(editor.value, layer);
      layer.parentElement.classList.add('highlight-ready');
      syncScroll();
    }
    const pos = caretPosition(editor.value, editor.selectionStart);
    cursor.textContent = 'Ln ' + pos.line + ', Col ' + pos.column;
  };
  const replace = (start, end, content) => {
    editor.setRangeText(content, start, end, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  editor.addEventListener('input', render);
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; syncScroll(); });
  editor.addEventListener('click', render);
  editor.addEventListener('keyup', render);
  editor.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!editor.readOnly) onFormat();
      return;
    }
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
