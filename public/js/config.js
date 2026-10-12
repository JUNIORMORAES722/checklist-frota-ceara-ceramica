// Configuração do cliente frontend (Frota Ceará Cerâmica)
(function () {
  if (typeof window === 'undefined') return;

  // Em branco usa o proxy da Vercel (mesma origem, zero problemas de CORS ou bloqueio de navegador):
  window.__API_URL__ = '';

  window.obterApiUrl = function () {
    return window.__API_URL__ || '';
  };

  window.definirApiUrl = function (url) {
    window.__API_URL__ = url ? String(url).trim().replace(/\/+$/, '') : '';
  };
})();
