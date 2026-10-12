const form = document.getElementById('formLogin');
const aviso = document.getElementById('aviso');
const senha = document.getElementById('senha');
let enviando = false;

if (sessionStorage.getItem('tokenFrota')) {
  window.location.replace(sessionStorage.getItem('tipoUsuario') === 'gestor' ? 'tela3.html' : 'tela2.html');
}

document.getElementById('mostrarSenha').addEventListener('click', () => {
  const visivel = senha.type === 'text';
  senha.type = visivel ? 'password' : 'text';
  const botao = document.getElementById('mostrarSenha');
  botao.textContent = visivel ? 'Mostrar' : 'Ocultar';
  botao.setAttribute('aria-pressed', visivel ? 'false' : 'true');
});

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (enviando) return;
  const perfil = evento.submitter && evento.submitter.dataset.perfil;
  if (!perfil) return;
  esconder(aviso);
  enviando = true;
  const botoes = form.querySelectorAll('button[type="submit"]');
  botoes.forEach((botao) => { botao.disabled = true; });
  evento.submitter.textContent = 'Entrando...';
  try {
    const rota = perfil === 'gestor' ? '/gestores/login' : '/motoristas/login';
    const resultado = await requisicao(rota, {
      method: 'POST',
      json: {
        usuario: document.getElementById('usuario').value.trim(),
        senha: senha.value
      }
    });
    sessionStorage.setItem('tokenFrota', resultado.dados.token);
    sessionStorage.setItem('tipoUsuario', resultado.dados.tipo);
    sessionStorage.setItem('usuarioLogado', resultado.dados.nome);
    sessionStorage.setItem('usuarioId', resultado.dados.id);
    window.location.replace(resultado.dados.tipo === 'gestor' ? 'tela3.html' : 'tela2.html');
  } catch (erro) {
    mostrar(aviso, erro.message || 'Usuário ou senha inválidos.');
    senha.value = '';
    senha.type = 'password';
    const botaoSenha = document.getElementById('mostrarSenha');
    botaoSenha.textContent = 'Mostrar';
    botaoSenha.setAttribute('aria-pressed', 'false');
    botoes.forEach((botao) => { botao.disabled = false; });
    document.getElementById('btnMotorista').textContent = 'Entrar como motorista';
    document.getElementById('btnGestor').textContent = 'Entrar como gestor';
    enviando = false;
  }
});

const btnServidor = document.getElementById('btnServidor');
if (btnServidor) {
  btnServidor.addEventListener('click', () => {
    const atual = (typeof obterApiUrl === 'function' ? obterApiUrl() : '') || '';
    const nova = window.prompt(
      'URL do backend (Render):\nExemplo: https://frota-ceara-backend.onrender.com\n\nDeixe em branco para usar a mesma origem (local/proxy):',
      atual
    );
    if (nova !== null) {
      if (typeof definirApiUrl === 'function') definirApiUrl(nova.trim());
      const configurada = (typeof obterApiUrl === 'function' ? obterApiUrl() : '') || 'mesma origem';
      alert('Servidor configurado para: ' + configurada);
    }
  });
}
