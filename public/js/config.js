// Configuração do cliente frontend (Frota Ceará Cerâmica)
(function () {
  if (typeof window === 'undefined') return;

  // URL fixa do backend no Render:
  window.__API_URL__ = 'https://frota-ceara-backend.onrender.com';

  window.obterApiUrl = function () {
    return window.__API_URL__;
  };

  window.definirApiUrl = function (url) {
    if (url) window.__API_URL__ = String(url).trim().replace(/\/+$/, '');
  };
})();
