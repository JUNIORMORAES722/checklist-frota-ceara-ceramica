const ITENS_CHECKLIST = [
  'CRLV em dia',
  'Triângulo, Macaco e Estepe',
  'Pneus e Calibragem',
  'Faróis e Lanternas',
  'Freios',
  'Buzina e Vidros',
  'Cintos de Segurança'
];

const BLOCOS_CHECKLIST = [
  { titulo: 'Documentação e segurança', itens: ['CRLV em dia', 'Triângulo, Macaco e Estepe'] },
  { titulo: 'Mecânica e exterior', itens: ['Pneus e Calibragem', 'Faróis e Lanternas', 'Freios'] },
  { titulo: 'Cabine e operação', itens: ['Buzina e Vidros', 'Cintos de Segurança'] }
];

const COMBUSTIVEIS = ['reserva', '1/4', '1/2', '3/4', 'cheio'];

module.exports = { ITENS_CHECKLIST, BLOCOS_CHECKLIST, COMBUSTIVEIS };
