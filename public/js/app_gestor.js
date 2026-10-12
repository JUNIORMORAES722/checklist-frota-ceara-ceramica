let pagina = 1;
let limite = 8;
let total = 0;
let cache = [];
let detalheAtual = null;
let idExclusao = null;

document.getElementById('btnSair').addEventListener('click', sair);

function falha(erro) {
  mostrar(document.getElementById('aviso'), erro.message || 'Não foi possível concluir a operação.');
}

function celula(rotulo, texto) {
  const td = document.createElement('td');
  td.dataset.label = rotulo;
  td.textContent = texto;
  return td;
}

function selo(status) {
  const span = document.createElement('span');
  span.className = status === 'OK' ? 'selo selo-ok' : 'selo selo-pendente';
  span.textContent = status === 'OK' ? 'Conforme' : 'Pendência';
  return span;
}

function desenharLista(itens) {
  const corpo = document.getElementById('lista');
  corpo.replaceChildren();
  if (!itens.length) {
    const tr = document.createElement('tr');
    const td = celula('', 'Nenhum checklist neste filtro.');
    td.colSpan = 6;
    tr.appendChild(td);
    corpo.appendChild(tr);
    return;
  }
  itens.forEach((item) => {
    const tr = document.createElement('tr');
    tr.appendChild(celula('Data', `${item.data} ${item.hora || ''}`.trim()));
    tr.appendChild(celula('Placa', item.placa));
    tr.appendChild(celula('Motorista', item.motorista));
    const km = document.createElement('td');
    km.dataset.label = 'Km';
    km.textContent = Number.isInteger(item.km) ? item.km.toLocaleString('pt-BR') : '-';
    if (item.kmInconsistente) {
      const marca = document.createElement('div');
      marca.className = 'selo selo-alerta';
      marca.textContent = 'Revisar km';
      km.appendChild(marca);
    }
    tr.appendChild(km);
    const status = document.createElement('td');
    status.dataset.label = 'Status';
    status.appendChild(selo(item.status));
    tr.appendChild(status);
    const acoes = document.createElement('td');
    acoes.dataset.label = 'Ações';
    acoes.className = 'linha-acoes';
    const ver = document.createElement('button');
    ver.className = 'botao';
    ver.type = 'button';
    ver.textContent = 'Ver';
    ver.addEventListener('click', () => abrirDetalhe(item.id));
    const imprimir = document.createElement('button');
    imprimir.className = 'botao-secundario';
    imprimir.type = 'button';
    imprimir.textContent = 'Imprimir';
    imprimir.addEventListener('click', () => imprimirChecklist(item.id));
    const excluir = document.createElement('button');
    excluir.className = 'botao-perigo';
    excluir.type = 'button';
    excluir.textContent = 'Excluir';
    excluir.addEventListener('click', () => pedirExclusao(item.id));
    acoes.append(ver, imprimir, excluir);
    tr.appendChild(acoes);
    corpo.appendChild(tr);
  });
}

async function carregar(novaPagina) {
  pagina = novaPagina || 1;
  const params = new URLSearchParams({ pagina: String(pagina), limite: String(limite) });
  const inicio = document.getElementById('dataInicio').value;
  const fim = document.getElementById('dataFim').value;
  const placa = document.getElementById('filtroPlaca').value.trim();
  const motorista = document.getElementById('filtroMotorista').value.trim();
  const status = document.getElementById('filtroStatus').value;
  if (inicio) params.set('dataInicio', inicio);
  if (fim) params.set('dataFim', fim);
  if (placa) params.set('placa', placa);
  if (motorista) params.set('motorista', motorista);
  if (status) params.set('status', status);
  const resultado = await requisicao('/checklists?' + params.toString());
  cache = resultado.dados.itens;
  total = resultado.dados.total;
  document.getElementById('indTotal').textContent = String(resultado.dados.indicadores.total);
  document.getElementById('indOk').textContent = String(resultado.dados.indicadores.conformes);
  document.getElementById('indPendencia').textContent = String(resultado.dados.indicadores.pendencias);
  document.getElementById('indVeiculos').textContent = String(resultado.dados.indicadores.veiculosComPendencia);
  desenharLista(cache);
  const paginas = Math.max(Math.ceil(total / limite), 1);
  document.getElementById('paginaInfo').textContent = total ? `Página ${pagina} de ${paginas}` : 'Sem registros';
}

function paragrafo(rotulo, valor) {
  const p = document.createElement('p');
  const forte = document.createElement('strong');
  forte.textContent = rotulo;
  p.append(forte, document.createTextNode(' ' + (valor || '-')));
  return p;
}

async function abrirDetalhe(id) {
  const resultado = await requisicao('/checklists/' + encodeURIComponent(id));
  detalheAtual = resultado.dados;
  const corpo = document.getElementById('corpoDetalhe');
  corpo.replaceChildren();
  corpo.append(
    paragrafo('Data:', `${detalheAtual.data} ${detalheAtual.hora || ''}`.trim()),
    paragrafo('Veículo:', `${detalheAtual.placa} ${detalheAtual.descricaoVeiculo || ''}`.trim()),
    paragrafo('Motorista:', detalheAtual.motorista),
    paragrafo('Quilometragem:', Number.isInteger(detalheAtual.km) ? detalheAtual.km.toLocaleString('pt-BR') : '-'),
    paragrafo('Resultado:', detalheAtual.status),
    paragrafo('Combustível:', detalheAtual.combustivel),
    paragrafo('Itens não ok:', detalheAtual.itensNaoOk.length ? detalheAtual.itensNaoOk.join(', ') : 'Nenhum'),
    paragrafo('Observações:', detalheAtual.obs || 'Sem observações')
  );
  if (detalheAtual.kmInconsistente) {
    const alerta = document.createElement('p');
    alerta.className = 'aviso';
    alerta.textContent = 'A quilometragem original foi preservada e está sinalizada para análise.';
    corpo.appendChild(alerta);
  }
  const fotoTitulo = document.createElement('h3');
  fotoTitulo.textContent = 'Fotografia';
  corpo.appendChild(fotoTitulo);
  if (detalheAtual.temFoto) {
    const imagem = document.createElement('img');
    imagem.className = 'foto-registro';
    imagem.alt = 'Fotografia da inspeção';
    const arquivo = await fetch(urlApi('/checklists/' + encodeURIComponent(id) + '/foto'), {
      headers: { Authorization: 'Bearer ' + sessionStorage.getItem('tokenFrota') }
    });
    if (arquivo.ok) imagem.src = URL.createObjectURL(await arquivo.blob());
    corpo.appendChild(imagem);
  } else {
    corpo.appendChild(paragrafo('', 'Sem fotografia neste registro.'));
  }

  const tituloPendencias = document.createElement('h3');
  tituloPendencias.textContent = 'Pendências';
  corpo.appendChild(tituloPendencias);
  if (!detalheAtual.pendencias.length) {
    corpo.appendChild(paragrafo('', 'Nenhuma pendência registrada.'));
  }
  detalheAtual.pendencias.forEach((pendencia) => corpo.appendChild(blocoPendencia(pendencia)));

  const correcao = document.createElement('h3');
  correcao.textContent = 'Correção administrativa da quilometragem';
  corpo.appendChild(correcao);
  const km = document.createElement('input');
  km.inputMode = 'numeric';
  km.placeholder = 'Nova quilometragem';
  const justificativa = document.createElement('textarea');
  justificativa.placeholder = 'Justificativa da correção';
  const salvarKm = document.createElement('button');
  salvarKm.className = 'botao';
  salvarKm.type = 'button';
  salvarKm.textContent = 'Registrar correção';
  salvarKm.addEventListener('click', async () => {
    await requisicao('/checklists/' + encodeURIComponent(id) + '/quilometragem', {
      method: 'PUT',
      json: { km: km.value.trim(), justificativa: justificativa.value }
    });
    await abrirDetalhe(id);
    await carregar(pagina);
  });
  corpo.append(km, justificativa, salvarKm);
  document.getElementById('dialogoDetalhe').classList.add('aberto');
}

function blocoPendencia(pendencia) {
  const caixa = document.createElement('section');
  caixa.className = 'secao';
  const titulo = document.createElement('h3');
  titulo.textContent = pendencia.item;
  const situacao = document.createElement('select');
  ['aberta', 'concluida'].forEach((valor) => {
    const opcao = document.createElement('option');
    opcao.value = valor;
    opcao.textContent = valor === 'aberta' ? 'Aberta' : 'Concluída';
    if (pendencia.situacao === valor) opcao.selected = true;
    situacao.appendChild(opcao);
  });
  const responsavel = document.createElement('input');
  responsavel.placeholder = 'Responsável';
  responsavel.value = pendencia.responsavel || '';
  const observacao = document.createElement('textarea');
  observacao.placeholder = 'Observação da resolução';
  observacao.value = pendencia.observacaoResolucao || '';
  const salvar = document.createElement('button');
  salvar.type = 'button';
  salvar.className = 'botao-secundario';
  salvar.textContent = 'Salvar pendência';
  salvar.addEventListener('click', async () => {
    await requisicao('/pendencias/' + encodeURIComponent(pendencia.id), {
      method: 'PUT',
      json: { situacao: situacao.value, responsavel: responsavel.value, observacaoResolucao: observacao.value }
    });
    await abrirDetalhe(pendencia.checklistId);
  });
  caixa.append(titulo, paragrafo('Aberta em:', pendencia.abertoEm), situacao, responsavel, observacao);
  if (pendencia.concluidoEm) caixa.appendChild(paragrafo('Concluída em:', pendencia.concluidoEm));
  caixa.appendChild(salvar);
  return caixa;
}

async function imprimirChecklist(id) {
  const resultado = await requisicao('/checklists/' + encodeURIComponent(id));
  let foto = '';
  if (resultado.dados.temFoto) {
    const arquivo = await fetch(urlApi('/checklists/' + encodeURIComponent(id) + '/foto'), {
      headers: { Authorization: 'Bearer ' + sessionStorage.getItem('tokenFrota') }
    });
    if (arquivo.ok) {
      const blob = await arquivo.blob();
      foto = await new Promise((resolve) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result);
        leitor.readAsDataURL(blob);
      });
    }
  }
  const janela = window.open('', '_blank');
  if (!janela) return;
  janela.document.open();
  janela.document.write(montarHtmlImpressao(resultado.dados, foto));
  janela.document.close();
  janela.focus();
  janela.print();
}

function pedirExclusao(id) {
  idExclusao = id;
  document.getElementById('dialogoConfirma').classList.add('aberto');
}

document.getElementById('confirmarExclusao').addEventListener('click', async () => {
  if (!idExclusao) return;
  await requisicao('/checklists/' + encodeURIComponent(idExclusao), { method: 'DELETE' });
  idExclusao = null;
  document.getElementById('dialogoConfirma').classList.remove('aberto');
  await carregar(pagina);
});
document.getElementById('cancelarExclusao').addEventListener('click', () => {
  idExclusao = null;
  document.getElementById('dialogoConfirma').classList.remove('aberto');
});
document.getElementById('fecharDetalhe').addEventListener('click', () => {
  document.getElementById('dialogoDetalhe').classList.remove('aberto');
});
document.getElementById('btnImprimir').addEventListener('click', () => {
  if (detalheAtual) imprimirChecklist(detalheAtual.id);
});

document.getElementById('filtros').addEventListener('submit', (evento) => {
  evento.preventDefault();
  esconder(document.getElementById('aviso'));
  carregar(1).catch(falha);
});
document.getElementById('btnLimpar').addEventListener('click', () => {
  document.getElementById('filtros').reset();
  carregar(1);
});
document.getElementById('paginaAnterior').addEventListener('click', () => {
  if (pagina > 1) carregar(pagina - 1);
});
document.getElementById('paginaProxima').addEventListener('click', () => {
  if (pagina * limite < total) carregar(pagina + 1);
});

function csvCampo(valor) {
  return campoCsv(valor);
}

document.getElementById('btnExportar').addEventListener('click', async () => {
  const params = new URLSearchParams({ pagina: '1', limite: '50' });
  const inicio = document.getElementById('dataInicio').value;
  const fim = document.getElementById('dataFim').value;
  const placa = document.getElementById('filtroPlaca').value.trim();
  const motorista = document.getElementById('filtroMotorista').value.trim();
  const status = document.getElementById('filtroStatus').value;
  if (inicio) params.set('dataInicio', inicio);
  if (fim) params.set('dataFim', fim);
  if (placa) params.set('placa', placa);
  if (motorista) params.set('motorista', motorista);
  if (status) params.set('status', status);
  const resultado = await requisicao('/checklists?' + params.toString());
  const linhas = ['Data,Hora,Placa,Motorista,KM,Status,Itens não ok,Quilometragem sinalizada'];
  resultado.dados.itens.forEach((item) => {
    linhas.push([
      item.data, item.hora, item.placa, item.motorista, item.km, item.status,
      item.itensNaoOk.join('; '), item.kmInconsistente ? 'sim' : 'não'
    ].map(csvCampo).join(','));
  });
  const blob = new Blob(['\ufeff', linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'checklists.csv';
  link.click();
});

async function carregarVeiculos() {
  const resultado = await requisicao('/veiculos');
  const lista = document.getElementById('listaVeiculos');
  lista.replaceChildren();
  resultado.dados.forEach((veiculo) => {
    const linha = document.createElement('p');
    const texto = document.createElement('span');
    texto.textContent = `${veiculo.placa} — ${veiculo.descricao}`;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'botao-secundario';
    botao.textContent = veiculo.ativo ? 'Desativar' : 'Reativar';
    botao.addEventListener('click', async () => {
      await requisicao('/veiculos/' + encodeURIComponent(veiculo.id), {
        method: 'PUT',
        json: { ativo: !veiculo.ativo }
      });
      await carregarVeiculos();
    });
    linha.append(texto, document.createTextNode(' '), botao);
    lista.appendChild(linha);
  });
}

document.getElementById('formVeiculo').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  await requisicao('/veiculos', {
    method: 'POST',
    json: {
      placa: document.getElementById('novaPlaca').value,
      descricao: document.getElementById('novaDescricao').value
    }
  });
  evento.target.reset();
  await carregarVeiculos();
});

async function preparar() {
  if (!sessionStorage.getItem('tokenFrota')) {
    window.location.replace('index.html');
    return;
  }
  const eu = await requisicao('/eu');
  if (eu.dados.tipo !== 'gestor') {
    window.location.replace(eu.dados.tipo === 'motorista' ? 'tela2.html' : 'index.html');
    return;
  }
  document.getElementById('nomeUsuario').textContent = eu.dados.nome;
  await carregar(1);
  await carregarVeiculos();
}

preparar().catch(falha);
window.addEventListener('unhandledrejection', (evento) => {
  evento.preventDefault();
  falha(evento.reason instanceof Error ? evento.reason : new Error('Não foi possível concluir a operação.'));
});
