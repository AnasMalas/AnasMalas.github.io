(function () {
  const root = document.documentElement;
  const button = document.querySelector("[data-theme-toggle]");
  const label = document.querySelector("[data-theme-label]");
  const themes = ["system", "light", "dark"];
  const saved = window.localStorage.getItem("theme");
  if (saved && themes.includes(saved)) root.dataset.theme = saved;

  function updateLabel() {
    if (label) label.textContent = root.dataset.theme[0].toUpperCase() + root.dataset.theme.slice(1);
    if (button) button.setAttribute("aria-label", `Color theme: ${root.dataset.theme}. Activate to change.`);
  }

  updateLabel();
  if (!button) return;
  button.addEventListener("click", function () {
    const current = themes.indexOf(root.dataset.theme);
    const next = themes[(current + 1) % themes.length];
    root.dataset.theme = next;
    window.localStorage.setItem("theme", next);
    updateLabel();
  });
}());
