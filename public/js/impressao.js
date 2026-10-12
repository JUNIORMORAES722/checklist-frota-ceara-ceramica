const ITENS_IMPRESSAO = [
  'CRLV em dia',
  'Triângulo, Macaco e Estepe',
  'Pneus e Calibragem',
  'Faróis e Lanternas',
  'Freios',
  'Buzina e Vidros',
  'Cintos de Segurança'
];

function campoCsv(valor) {
  let texto = String(valor ?? '');
  if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function montarHtmlImpressao(checklist, fotoDataUrl) {
  const registrados = new Set(checklist.itensNaoOk || []);
  const linhas = ITENS_IMPRESSAO.map((item, indice) => {
    const status = registrados.has(item) ? 'NÃO OK' : 'OK';
    return `<tr><td>${indice + 1}</td><td>${escaparHtml(item)}</td><td>${status}</td></tr>`;
  }).join('');
  const extras = (checklist.itensNaoOk || []).filter(item => !ITENS_IMPRESSAO.includes(item));
  const extrasHtml = extras.length
    ? `<h3>Itens registrados fora da lista padrão</h3><ul>${extras.map(item => `<li>${escaparHtml(item)} — NÃO OK</li>`).join('')}</ul>`
    : '';
  const foto = typeof fotoDataUrl === 'string' && fotoDataUrl.startsWith('data:image/')
    ? `<img src="${fotoDataUrl}" alt="Fotografia da inspeção" style="max-width:280px">`
    : '<p>Sem fotografia neste registro.</p>';
  const km = Number.isInteger(checklist.km) ? checklist.km.toLocaleString('pt-BR') : '-';
  const alertaKm = checklist.kmInconsistente
    ? '<p>Quilometragem preservada e sinalizada para análise. O valor original não foi alterado.</p>'
    : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Checklist ${escaparHtml(checklist.placa)}</title>
    <style>body{font-family:Segoe UI,sans-serif;margin:24px;color:#1c2832}table{width:100%;border-collapse:collapse}td,th{border:1px solid #1c2832;padding:8px;text-align:left}h1{font-size:20px}</style>
    </head><body>
    <p>Ceará Cerâmica</p>
    <h1>Frota Ceará Cerâmica — inspeção</h1>
    <p>Data: ${escaparHtml(checklist.data)} ${escaparHtml(checklist.hora || '')}</p>
    <p>Veículo: ${escaparHtml(checklist.placa)} ${escaparHtml(checklist.descricaoVeiculo || '')}</p>
    <p>Motorista: ${escaparHtml(checklist.motorista)}</p>
    <p>Quilometragem: ${escaparHtml(km)}</p>
    ${alertaKm}
    <p>Resultado: ${escaparHtml(checklist.status)}</p>
    <p>Combustível: ${escaparHtml(checklist.combustivel || '-')}</p>
    <h2>Itens verificados</h2>
    <table><thead><tr><th>#</th><th>Item</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table>
    ${extrasHtml}
    <h2>Observações</h2>
    <p>${escaparHtml(checklist.obs || 'Sem observações')}</p>
    <h2>Fotografia</h2>
    ${foto}
    <p>Impresso em ${escaparHtml(new Date().toLocaleString('pt-BR'))}</p>
    </body></html>`;
}

if (typeof module !== 'undefined') {
  module.exports = { escaparHtml, montarHtmlImpressao, ITENS_IMPRESSAO, campoCsv };
}
