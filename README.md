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

Para cadastrar tarifas utilizadas nas projeções, execute:

```text
database/005_tarifa_referencia.sql
```

Para impedir novas leituras com casas decimais diretamente no banco, execute:

```text
database/006_leitura_inteira.sql
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
GET  /api/dashboard-pagamentos?filial={IDFILIAL_USR}&funcionario={IDFUNCIONARIO}&filiais={LISTA}
GET  /api/dashboard-leituras?filial={IDFILIAL_USR}&funcionario={IDFUNCIONARIO}&filiais={LISTA}
GET  /api/dashboard-tarifas?filial={IDFILIAL_USR}&uf={UF}&cidade={CIDADE}
GET  /api/dashboard-acessos?filial={IDFILIAL_USR}&funcionario={IDFUNCIONARIO}
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

Motivo e observação permanecem opcionais quando não há aumento comparável. Se o
consumo calculado da nova leitura for maior que o consumo anterior do contador,
ambos tornam-se obrigatórios no formulário e na API.

Os motivos são organizados em:

```text
Falhas humanas / operacionais
Eventos externos ou sazonais
Problemas técnicos / estruturais
```

## Incorporação no Adianti

O formulário e o dashboard devem ser incorporados com altura limitada pelo
espaço disponível no Adianti e rolagem interna nos respectivos `iframes`.

## Dashboard

A página secundária `dashboard.html` é destinada ao Adianti:

```text
dashboard.html?a_system_user_unit_code={$a_system_user_unit_code}&a_system_user_custom_code={$a_system_user_custom_code}
```

Ela combina pagamentos de energia e água consultados no Firebird com o consumo
medido no Neon. A projeção mensal usa a média diária registrada e, quando
possível, o custo efetivo histórico da própria filial.

O dashboard envia sua altura total pela mensagem
`consumo-loja:dashboard-height`, permitindo que o Adianti expanda o iframe e
mostre todos os dados sem rolagem interna. O formulário mantém rolagem interna.

O objeto HTML do Adianti deve manter uma altura mínima até receber a altura
total enviada pelo dashboard:

```html
<iframe
  id="consumo-dashboard"
  src="https://consumo-loja.vercel.app/dashboard.html?a_system_user_unit_code={$a_system_user_unit_code}&a_system_user_custom_code={$a_system_user_custom_code}"
  style="display:block; width:100%; min-height:calc(100vh - 90px); border:0;"
  title="Dashboard de consumo">
</iframe>
<script>
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'consumo-loja:dashboard-height') {
      document.getElementById('consumo-dashboard').style.height =
        Math.max(event.data.height, window.innerHeight - 90) + 'px';
    }
  });
</script>
```

O código do funcionário recebido em `a_system_user_custom_code` é consultado no
Firebird. Funcionários ativos da categoria `DI` podem selecionar todas as
filiais com supervisor. Funcionários `SU` podem selecionar as filiais em que
são o supervisor. As demais categorias, códigos ausentes ou inválidos
permanecem limitados à filial recebida do Adianti. Pagamentos e leituras
validam novamente essa autorização na API antes de retornar múltiplas filiais.

Quando `a_system_user_custom_code` estiver vazio ou não for substituído pelo
Adianti, nenhuma consulta multifilial será liberada. Nesse caso, o dashboard
utiliza exclusivamente `a_system_user_unit_code`.

A projeção financeira é comparada com o último mês pago de cada recurso,
mostrando diferença em reais, percentual e se ficará acima ou abaixo. A tabela
de aumentos separa classificação do motivo, motivo informado e justificativa.

A tendência também compara o consumo projetado com a média de até três meses
recentes, destacando aumento em vermelho, redução em verde e estabilidade em
cinza.

Quando há pagamento e consumo medido para a mesma competência mensal, o
dashboard calcula a tarifa efetiva daquele mês:

```text
tarifa efetiva = valor pago da competência / consumo medido da competência
```

A mediana das últimas competências completas tem prioridade nas projeções. Sem
esse histórico, o dashboard utiliza a tarifa cadastrada e, por último, um
fallback externo calibrado por UF. O fallback inicial de energia do RJ aplica
o fator do exemplo real informado:

```text
R$ 10.127 / 7.110 kWh = R$ 1,424332/kWh
```

Sem histórico medido suficiente, estima o consumo faturado por:

```text
consumo estimado = valor pago / tarifa de referência
```

Nos cartões de tendência, a variação percentual entre a projeção e sua
referência é destacada com sinal positivo ou negativo e a indicação de aumento
ou redução.

Os valores de consumo de energia e água são exibidos como números inteiros. As
tarifas, percentuais e valores financeiros preservam suas casas decimais.

O dashboard classifica as contas do ERP por:

```text
1.02.01.03 -> Energia
1.02.01.02 -> Água
```
