/* Runs on every static Astro page. No framework runtime required. */
(() => {
  const themes = new Set(["dark", "navy", "light"]);
  const themeColors = { dark: "#080b0e", navy: "#13263d", light: "#ffffff" };
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll("[data-theme-choice]")];

  function applyTheme(theme) {
    if (!themes.has(theme)) return;
    root.dataset.theme = theme;
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", themeColors[theme]);
  }

  applyTheme(root.dataset.theme === "brown" ? "navy" : root.dataset.theme || "dark");

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const theme = button.dataset.themeChoice;
      if (!themes.has(theme)) return;
      applyTheme(theme);
      try {
        localStorage.setItem("oreslang-theme", theme);
      } catch {
        /* Storage may be disabled; switching still works for this page. */
      }
    });
  }

  for (const link of document.querySelectorAll(".mobile-navigation nav a")) {
    link.addEventListener("click", () => {
      link.closest("details")?.removeAttribute("open");
    });
  }
})();
