// Configuração do cliente frontend (Frota Ceará Cerâmica)
//
// Ao hospedar o frontend na Vercel e o backend no Render:
//
// Opção 1: Definir a URL do backend diretamente abaixo (ideal para produção na Vercel):
//   window.__API_URL__ = 'https://frota-ceara-backend.onrender.com';
//
// Opção 2: Deixar vazio '' para:
//   - Usar a mesma origem (quando executado junto localmente ou servido pelo Render)
//   - Ou usar a URL configurada dinamicamente via tela de login (localStorage)
//
(function () {
  if (typeof window === 'undefined') return;

  // Defina aqui a URL do backend no Render se desejar fixá-la:
  window.__API_URL__ = window.__API_URL__ || '';

  window.obterApiUrl = function () {
    if (window.__API_URL__) return String(window.__API_URL__).replace(/\/+$/, '');
    try {
      const salva = localStorage.getItem('API_URL');
      if (salva) return salva.replace(/\/+$/, '');
    } catch { /* localStorage desabilitado */ }
    return '';
  };

  window.definirApiUrl = function (url) {
    try {
      if (!url) {
        localStorage.removeItem('API_URL');
      } else {
        localStorage.setItem('API_URL', String(url).trim().replace(/\/+$/, ''));
      }
    } catch { /* localStorage desabilitado */ }
  };
})();

