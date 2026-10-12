# Frota Ceará Cerâmica

Aplicação de gestão de frota e inspeções veiculares da Ceará Cerâmica. O motorista registra o checklist do veículo. O gestor consulta o histórico, as pendências, as fotografias e exporta os registros.

Esta versão é uma amostra funcional. Ela não inclui produção, estoque, vendas nem outros módulos da empresa.

## Funcionalidades

- Login com senha armazenada apenas como hash e sessão com token.
- Perfis de motorista e gestor, conferidos no servidor.
- Checklist com os sete itens reais, veículo cadastrado, quilometragem, combustível, observação e fotografia.
- Recusa de quilometragem menor que o último registro confiável do veículo.
- Preservação de quilometragens antigas inconsistentes, apenas sinalizadas.
- Histórico com período, placa, motorista, status, paginação, detalhe, impressão e CSV.
- Pendência por item marcado como não ok, com responsável e conclusão manuais.
- Fotografias gravadas fora da pasta pública.
- Backup do banco e das fotografias, com teste de restauração.
- Dados demonstrativos fictícios, separados do banco operacional.

## Tecnologias

Node.js, Express, SQLite incluído no Node, bcrypt e JWT. A interface é HTML, CSS e JavaScript, sem outro framework.

## Requisitos

- Node.js 22 ou superior.
- Windows, para os comandos abaixo. O servidor também escuta na rede local.

Se a instalação falhar por certificado, use a autoridade do sistema e repita o `npm ci`:

```powershell
$env:NODE_OPTIONS="--use-system-ca"
```

## Configuração

Numa máquina nova, use somente o código publicado. Não copie `db.json`, `data/`, fotografias, backups nem o `.env` de outro computador.

```powershell
npm ci
copy .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Coloque o valor gerado em `JWT_SECRET` dentro do `.env`. O servidor recusa segredo ausente, curto ou igual a um exemplo conhecido. Não publique o `.env`.

Para criar a base fictícia e os usuários `helena` (gestor) e `paulo` (motorista), escolha as senhas só nesta máquina:

```powershell
$env:SENHA_GESTOR = "escolha-uma-senha"
$env:SENHA_MOTORISTA = "escolha-outra-senha"
npm run seed:demo
Remove-Item Env:SENHA_GESTOR, Env:SENHA_MOTORISTA
```

O comando grava `data/demo.sqlite` e recusa o arquivo `frota.sqlite`. Antes de `npm start`, deixe no `.env` a linha `SQLITE_PATH=data/demo.sqlite`. As senhas não ficam no repositório.

Quem já possui um `db.json` local, fora do Git, pode importá-lo sem apagá-lo:

```powershell
npm run migrar
```

O comando cria `data/frota.sqlite`. Pode ser executado de novo sem duplicar registros. Nesse caso, `SQLITE_PATH` permanece `data/frota.sqlite`.

Para gerar o hash de uma senha nova, sem gravá-la em arquivo:

```powershell
$env:SENHA = "escolha-uma-senha"
node gerarSenha.js
Remove-Item Env:SENHA
```

Copie somente o hash impresso para o cadastro local. O comando não altera o banco sozinho.

## Execução

```powershell
npm start
```

Abra http://localhost:3001 neste computador.

Em outro aparelho na mesma rede, descubra o endereço com `ipconfig` e use `http://IP-DA-MAQUINA:3001`. A página e a API saem do mesmo endereço, então não é preciso configurar CORS para esse uso. Libere a porta 3001 no firewall do Windows somente para a rede privada. O tráfego é HTTP: não publique o servidor na internet e não trate a rede local como se fosse HTTPS.

## Hospedagem

Uma publicação acessível fora da rede local precisa de um proxy com HTTPS na frente deste processo. O Node continua sem certificado próprio. Defina `JWT_SECRET` no ambiente do servidor, não no repositório. Mantenha `SQLITE_PATH` e `FOTOS_PATH` num disco persistente, fora da pasta `public`. Se o navegador chamar a API a partir de outro endereço, liste esse endereço em `CORS_ORIGENS`. Sem essa variável, só são aceitas as origens locais da porta em execução. Não abra a porta 3001 diretamente na internet.

## Testes

```powershell
npm test
```

A suíte cria bancos e fotografias temporários, com usuários fictícios, e apaga esses arquivos ao terminar. Ela não lê `db.json` nem `data/frota.sqlite`.

## Backup e restauração

```powershell
npm run backup
```

As cópias ficam em `backups/`, fora de `data/`. A retenção padrão é 14 dias (`BACKUP_RETENCAO_DIAS`).

Para restaurar uma cópia em um destino explícito, sem substituir o banco em uso às cegas:

```powershell
npm run restaurar -- --origem backups\NOME-DA-PASTA --banco data\restaurado.sqlite --fotos data\fotos-restauradas
```

No Agendador de Tarefas do Windows, crie uma tarefa diária cujo programa seja `node` e os argumentos `scripts/backup.js`, iniciando na pasta do projeto. O agendamento em si fica no sistema operacional.

## Limitações

- O processo Node não termina TLS. Fora da máquina local, o acesso depende do proxy descrito acima.
- Resolver uma pendência não altera o resultado histórico do checklist, e um checklist posterior conforme não encerra a ocorrência anterior.
- Registros antigos sem arquivo de imagem continuam sem fotografia.
- Quilometragens anteriores que diminuem são mantidas e marcadas para análise.
- O backup agendado depende do Agendador de Tarefas do Windows.
