# Consumo das lojas

Formulário estático para cadastro de relógios e, futuramente, lançamento
diário do consumo de energia e água das lojas.

## Como testar

Abra `index.html` incluindo a filial na URL:

```text
index.html?$a_system_user_unit_code=10
```

Os cadastros são gravados no banco Neon pela API hospedada na Vercel.

O formulário reconhece o parâmetro enviado pelo Adianti:

```text
$a_system_user_unit_code
```

Por compatibilidade durante os testes, `IDFILIAL_USR` também é aceito. O valor
recebido é gravado como `IDFILIAL_USR` nos registros dos contadores.

## Dados do contador

A tabela `cadastro_contador` precisará dos seguintes campos:

```text
ID_CONTADOR
IDFILIAL_USR
APELIDO_CONTADOR
NUMERO_CONTADOR
DATA_CADASTRO
TIPO_CONTADOR
STATUS
```

`TIPO_CONTADOR` é necessário para distinguir os relógios de energia e água.
O tipo é definido automaticamente conforme a seção onde o cadastro foi aberto:

```text
Seção Energia -> ENERGIA
Seção Água    -> AGUA
```

`ID_CONTADOR` deve ser a chave primária gerada pelo banco.

`STATUS` controla se o contador está disponível para receber leituras:

```text
T -> Ativo
F -> Inativo
```

A API retorna apenas contadores ativos. Novos cadastros são gravados
automaticamente com `STATUS = 'T'`.

Também é recomendável criar uma restrição única para:

```text
IDFILIAL_USR + TIPO_CONTADOR + NUMERO_CONTADOR
```

Isso impede o cadastro repetido do mesmo relógio na mesma filial.

## Banco de dados

Execute o arquivo `database/001_cadastro_contador.sql` no Neon antes do
primeiro teste.

Para bancos que já possuem a tabela, execute também:

```text
database/002_status_cadastro_contador.sql
```

Para criar o histórico de leituras, execute:

```text
database/003_leitura_contador.sql
```

Para preparar justificativas no dashboard, execute:

```text
database/004_justificativa_leitura.sql
```

A tabela `leitura_contador` armazena:

```text
ID_LEITURA
IDFILIAL_USR
ID_CONTADOR
DATA_LEITURA
LEITURA
LEITURA_ANTERIOR
DATA_REGISTRO
```

Ao inserir uma leitura, o banco identifica automaticamente a leitura
imediatamente anterior pela `DATA_LEITURA`. Se uma leitura retroativa for
inserida entre dois registros, o campo `LEITURA_ANTERIOR` do registro seguinte
também é atualizado.

O banco também valida a sequência acumulada do contador:

```text
Nova leitura >= leitura anterior
Leitura retroativa <= próxima leitura já registrada
```

Uma leitura menor somente deve ser permitida em um fluxo específico de troca,
reinicialização ou virada do contador, que ainda será definido.

A integração Neon da Vercel deve disponibilizar uma destas variáveis:

```text
DATABASE_URL
POSTGRES_URL
POSTGRES_URL_NON_POOLING
```

## API

A aplicação expõe:

```text
GET  /api/contadores?filial={IDFILIAL_USR}
POST /api/contadores
POST /api/leituras
POST /api/login
GET  /api/dashboard-pagamentos?filial={IDFILIAL_USR}
GET  /api/dashboard-leituras?filial={IDFILIAL_USR}
```

O parâmetro recebido via GET deve ser validado pela API antes de qualquer
consulta ou gravação. Ele não deve ser considerado autorização por si só.

## Acesso híbrido

O formulário possui dois modos de acesso:

```text
Com a_system_user_unit_code -> abre diretamente no modo Adianti
Sem a_system_user_unit_code -> solicita login do ERP Firebird
```

No login alternativo, a API valida `LOGIN`, `SENHAWEB` e `STATUS = 'A'` na
tabela `FUNCIONARIO`. A filial retornada pelo ERP é usada para carregar o
formulário. As variáveis `DB_*_FB` precisam ser configuradas também no projeto
Vercel do consumo-loja.

O `IDFILIAL` é tratado como texto de exatamente dois caracteres e preserva
códigos numéricos ou alfanuméricos, por exemplo:

```text
01
05
CD
EN
TE
```

## Formulário de leituras

Para cada contador cadastrado, o formulário apresenta:

```text
Data da leitura
Valor da leitura em kWh ou m³
Motivo
Observação
Última leitura registrada
```

Data e valor são obrigatórios para todos os contadores. O envio é realizado em
uma única transação: se uma leitura for inválida ou duplicada, nenhuma leitura
do conjunto é gravada. A restrição única `(ID_CONTADOR, DATA_LEITURA)` impede
mais de uma leitura para o mesmo contador na mesma data.

## Altura automática no Adianti

O formulário envia sua altura ao contêiner pai pela mensagem:

```text
consumo-loja:height
```

O HTML que incorpora o formulário deve ouvir essa mensagem e atualizar a
altura do `iframe`. Assim, a página principal controla a rolagem e o formulário
não exibe uma barra de rolagem interna.

## Dashboard

A página secundária `dashboard.html` é destinada ao Adianti:

```text
dashboard.html?a_system_user_unit_code={$a_system_user_unit_code}
```

Ela combina pagamentos de energia e água consultados no Firebird com o consumo
medido no Neon. A projeção mensal usa a média diária registrada e, quando
possível, o custo efetivo histórico da própria filial.
