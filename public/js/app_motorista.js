const ITENS = [
  ['crlv', 'CRLV em dia'],
  ['triangulo', 'Triângulo, Macaco e Estepe'],
  ['pneus', 'Pneus e Calibragem'],
  ['farois', 'Faróis e Lanternas'],
  ['freios', 'Freios'],
  ['buzina', 'Buzina e Vidros'],
  ['cintos', 'Cintos de Segurança']
];

const aviso = document.getElementById('aviso');
const sucesso = document.getElementById('sucesso');
const botaoSalvar = document.getElementById('btnSalvar');

document.getElementById('btnSair').addEventListener('click', sair);

async function preparar() {
  const token = sessionStorage.getItem('tokenFrota');
  if (!token) {
    window.location.replace('index.html');
    return;
  }
  try {
    const eu = await requisicao('/eu');
    if (eu.dados.tipo !== 'motorista') {
      window.location.replace(eu.dados.tipo === 'gestor' ? 'tela3.html' : 'index.html');
      return;
    }
    document.getElementById('nomeUsuario').textContent = eu.dados.nome;
    document.getElementById('motorista').value = eu.dados.nome;
    document.getElementById('data').value = hojeLocal();
    document.getElementById('hora').value = horaLocal();
    const veiculos = await requisicao('/veiculos');
    const select = document.getElementById('veiculo');
    veiculos.dados.forEach((veiculo) => {
      const opcao = document.createElement('option');
      opcao.value = veiculo.id;
      opcao.textContent = `${veiculo.placa} — ${veiculo.descricao}`;
      select.appendChild(opcao);
    });
  } catch (erro) {
    mostrar(aviso, erro.message);
  }
}

document.getElementById('foto').addEventListener('change', () => {
  const arquivo = document.getElementById('foto').files[0];
  const previa = document.getElementById('previa');
  document.getElementById('nomeFoto').textContent = arquivo ? arquivo.name : 'Nenhuma fotografia selecionada.';
  if (!arquivo) {
    previa.classList.add('oculto');
    previa.removeAttribute('src');
    return;
  }
  const leitor = new FileReader();
  leitor.onload = () => {
    previa.src = leitor.result;
    previa.classList.remove('oculto');
  };
  leitor.readAsDataURL(arquivo);
});

document.getElementById('formChecklist').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  esconder(aviso);
  esconder(sucesso);
  const faltando = ITENS.some(([nome]) => !document.querySelector(`input[name="${nome}"]:checked`));
  if (faltando) {
    mostrar(aviso, 'Marque OK ou Não OK em todos os itens.');
    return;
  }
  const itensNaoOk = ITENS
    .filter(([nome]) => document.querySelector(`input[name="${nome}"]:checked`).value === 'NÃO OK')
    .map(([, rotulo]) => rotulo);
  const dados = new FormData();
  dados.set('veiculoId', document.getElementById('veiculo').value);
  dados.set('data', document.getElementById('data').value);
  dados.set('hora', document.getElementById('hora').value.slice(0, 5));
  dados.set('km', document.getElementById('km').value.trim());
  dados.set('combustivel', document.getElementById('combustivel').value);
  dados.set('itensNaoOk', JSON.stringify(itensNaoOk));
  dados.set('obs', document.getElementById('obs').value);
  const arquivo = document.getElementById('foto').files[0];
  if (arquivo) dados.set('foto', arquivo);

  botaoSalvar.disabled = true;
  botaoSalvar.textContent = 'Salvando...';
  try {
    const resultado = await requisicao('/checklists', { method: 'POST', body: dados });
    mostrar(sucesso, resultado.status === 200
      ? 'Este envio repetido foi reconhecido e não gerou outro checklist.'
      : 'Checklist salvo.');
    document.getElementById('formChecklist').reset();
    document.getElementById('motorista').value = document.getElementById('nomeUsuario').textContent;
    document.getElementById('data').value = hojeLocal();
    document.getElementById('hora').value = horaLocal();
    document.getElementById('nomeFoto').textContent = 'Nenhuma fotografia selecionada.';
    document.getElementById('previa').classList.add('oculto');
  } catch (erro) {
    mostrar(aviso, erro.message);
  } finally {
    botaoSalvar.disabled = false;
    botaoSalvar.textContent = 'Salvar checklist';
  }
});

preparar();
