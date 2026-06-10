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
```

`TIPO_CONTADOR` é necessário para distinguir os relógios de energia e água.
O tipo é definido automaticamente conforme a seção onde o cadastro foi aberto:

```text
Seção Energia -> ENERGIA
Seção Água    -> AGUA
```

`ID_CONTADOR` deve ser a chave primária gerada pelo banco.

Também é recomendável criar uma restrição única para:

```text
IDFILIAL_USR + TIPO_CONTADOR + NUMERO_CONTADOR
```

Isso impede o cadastro repetido do mesmo relógio na mesma filial.

## Banco de dados

Execute o arquivo `database/001_cadastro_contador.sql` no Neon antes do
primeiro teste.

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
```

O parâmetro recebido via GET deve ser validado pela API antes de qualquer
consulta ou gravação. Ele não deve ser considerado autorização por si só.
