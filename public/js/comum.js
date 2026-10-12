function urlApi(caminho) {
  const base = typeof obterApiUrl === 'function' ? obterApiUrl() : '';
  if (!base) return caminho;
  const path = caminho.startsWith('/') ? caminho : '/' + caminho;
  return base + path;
}

async function requisicao(caminho, opcoes = {}) {
  const headers = new Headers(opcoes.headers || {});
  const token = sessionStorage.getItem('tokenFrota');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  let body = opcoes.body || null;
  if (opcoes.json) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opcoes.json);
  }
  let resposta;
  try {
    resposta = await fetch(urlApi(caminho), { method: opcoes.method || 'GET', headers, body });
  } catch (erroRede) {
    const base = typeof obterApiUrl === 'function' ? obterApiUrl() : '';
    const msg = base
      ? `Não foi possível conectar ao backend (${base}). Se o servidor estiver no Render gratuito, aguarde cerca de 50 segundos para despertar.`
      : 'Não foi possível conectar ao servidor. Verifique a conexão ou a URL do backend.';
    const erro = new Error(msg);
    erro.status = 0;
    erro.causaOriginal = erroRede;
    throw erro;
  }
  const texto = await resposta.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { erro: texto }; }
  if (resposta.status === 401 && !caminho.includes('/login')) {
    sessionStorage.clear();
    window.location.replace('index.html');
    throw new Error((dados && dados.erro) || 'Sessão expirada.');
  }
  if (!resposta.ok) {
    const erro = new Error((dados && dados.erro) || 'Não foi possível concluir a operação.');
    erro.status = resposta.status;
    throw erro;
  }
  return { status: resposta.status, dados };
}

function sair() {
  sessionStorage.clear();
  window.location.replace('index.html');
}

function hojeLocal() {
  const data = new Date();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function horaLocal() {
  const data = new Date();
  return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
}

function mostrar(elemento, texto) {
  elemento.textContent = texto;
  elemento.classList.remove('oculto');
}

function esconder(elemento) {
  elemento.textContent = '';
  elemento.classList.add('oculto');
}
