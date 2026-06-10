# Consumo das lojas

Formulário estático para cadastro de relógios e, futuramente, lançamento
diário do consumo de energia e água das lojas.

## Como testar

Abra `index.html` incluindo a filial na URL:

```text
index.html?$a_system_user_unit_code=10
```

Nesta primeira versão, os cadastros são gravados no `localStorage` do
navegador. Isso permite validar o fluxo e a interface antes da API Vercel e do
banco próprio estarem disponíveis.

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
`ID_CONTADOR` deve ser a chave primária gerada pelo banco.

Também é recomendável criar uma restrição única para:

```text
IDFILIAL_USR + TIPO_CONTADOR + NUMERO_CONTADOR
```

Isso impede o cadastro repetido do mesmo relógio na mesma filial.

## Integração futura

A API deverá expor, inicialmente:

```text
GET  /api/contadores?filial={IDFILIAL_USR}
POST /api/contadores
```

O parâmetro recebido via GET deve ser validado pela API antes de qualquer
consulta ou gravação. Ele não deve ser considerado autorização por si só.
