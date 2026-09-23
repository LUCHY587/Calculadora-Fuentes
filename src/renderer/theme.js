(function () {
  'use strict';
  // Por defecto arranca en modo claro; si la persona eligió oscuro, se recuerda.
  var t = 'light';
  try { if (localStorage.getItem('ca.theme') === 'dark') t = 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t);
})();
