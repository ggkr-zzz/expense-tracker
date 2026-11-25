// Loaded in <head> as a plain script so the saved theme is applied before the first paint.
// app.js owns the toggle; this file only decides the starting theme.
(function () {
  var theme = null;
  try {
    theme = window.localStorage.getItem("expense-tracker.theme");
  } catch (error) {
    // Storage is blocked: fall through to the system setting.
  }
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
