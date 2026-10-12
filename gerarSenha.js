const bcrypt = require('bcrypt');

async function gerar() {
  const senha = process.env.SENHA;

  if (!senha) {
    console.error('Defina a variável de ambiente SENHA com a nova senha.');
    console.error('Copie somente o hash impresso para o campo senha da conta em db.json.');
    console.error('Este arquivo não guarda senha. A aplicação não troca senhas sozinha.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(senha, 10);
  console.log(hash);
}

gerar();
