// Apply the site's shared preference before first paint without inline scripts.
(function () {
  var saved;
  try { saved = localStorage.getItem('theme'); } catch (_) {}
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark'
    ? saved
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
