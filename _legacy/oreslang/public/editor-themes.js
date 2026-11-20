/* Every code panel has its own persisted editor palette.
   Site-wide Dark/Navy/White remains a completely independent preference. */
(() => {
  const valid = new Set(["vscode", "intellij", "sublime", "zed", "emacs", "vim"]);
  const editors = document.querySelectorAll("[data-code-editor]");

  for (const editor of editors) {
    const picker = editor.querySelector("[data-code-theme-picker]");
    if (!picker) continue;
    const identity = editor.dataset.codeKey || "code";
    const storageKey = "oreslang-editor-theme:" + location.pathname + ":" + identity;

    function apply(theme) {
      if (!valid.has(theme)) return false;
      editor.dataset.editorTheme = theme;
      picker.value = theme;
      return true;
    }

    try {
      apply(localStorage.getItem(storageKey) || "vscode");
    } catch {
      apply("vscode");
    }

    picker.addEventListener("change", () => {
      if (!apply(picker.value)) {
        apply("vscode");
        return;
      }
      try {
        localStorage.setItem(storageKey, picker.value);
      } catch {
        /* Selection still works when persistence is unavailable. */
      }
    });
  }
})();
