# Consumo das lojas

Formulário estático para cadastro de relógios e, futuramente, lançamento
diário do consumo de energia e água das lojas.

O manual animado de utilização está disponível em:

```text
/manual.html
```

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

Para controlar os dias completos que aguardam sincronização com o Firebird,
execute:

```text
database/007_sincronizacao_firebird.sql
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

A integração Upstash Redis da Vercel deve disponibilizar:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

As consultas Firebird usadas pelo dashboard são cacheadas no Redis por 1 hora.
O tempo e os limites operacionais podem ser ajustados por:

```text
FIREBIRD_CONNECTION_MODE=redis-only
FIREBIRD_CACHE_TTL_SECONDS=3600
FIREBIRD_STALE_CACHE_TTL_SECONDS=86400
REDIS_CACHE_TIMEOUT_MS=1500
```

O modo também pode ser definido no arquivo:

```text
config/firebird-cache.json
```

Use `redis-only` enquanto a Vercel não tiver acesso direto ao Firebird. Nesse
modo, o dashboard lê os dados que foram sincronizados previamente no Redis e
não tenta abrir conexão com o ERP pela Vercel. Quando a liberação no servidor
Firebird estiver pronta, altere para `direct` no JSON ou configure
`FIREBIRD_CONNECTION_MODE=direct` na Vercel.

`FIREBIRD_STALE_CACHE_TTL_SECONDS` mantém uma cópia expirada por mais tempo
para ser usada se o Firebird ficar temporariamente indisponível. O Redis tem
timeout curto para não bloquear o dashboard caso o cache esteja lento.

Quando muitos usuários solicitam a mesma consulta ao mesmo tempo após o cache
vencer, o backend usa uma trava curta no Redis para reduzir consultas
duplicadas ao Firebird.

Não é necessário criar tabelas, índices ou chaves manualmente no Redis. As
chaves são criadas automaticamente com o prefixo `consumo-loja` conforme as
consultas forem executadas.

Para sincronizar Firebird -> Redis em uma máquina Windows que tenha acesso ao
ERP, copie o modelo:

```text
scripts/windows/sync-firebird-cache.local.example
```

para um arquivo local com este nome:

```text
C:\Users\Jean\consumo\sync-firebird-cache.local
```

Preencha no `.local` `DATABASE_URL`, `DB_*_FB`, `KV_REST_API_URL` e
`KV_REST_API_TOKEN`. O arquivo `sync-firebird-cache.local` fica fora do Git e é
lido pelo `.cmd` no momento da execução. Depois execute:

```text
scripts\windows\sync-firebird-cache.cmd
```

No Agendador de Tarefas do Windows, execute esse arquivo de 1 em 1 hora. O
sincronizador aquece o cache de pagamentos do dashboard, login de usuários
ativos, login administrativo e permissões multifiliais dos funcionários ativos
das categorias `DI` e `SU`.

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
formulário. Em `FIREBIRD_CONNECTION_MODE=redis-only`, essa validação usa os
usuários sincronizados no Redis pela máquina Windows. As variáveis `DB_*_FB`
ficam nessa máquina sincronizadora. Na Vercel, mantenha apenas as variáveis da
Upstash e `FIREBIRD_CONNECTION_MODE=redis-only`.

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

Na mesma transação do envio, a API cria um registro `PENDENTE` em
`sincronizacao_firebird` para cada data enviada que possuir leitura de todos os
contadores ativos da filial. A restrição única por filial e data impede
pendências duplicadas.

Motivo e observação permanecem opcionais enquanto o aumento calculado não
ultrapassar o limite do recurso. O percentual compara a leitura acumulada atual
com a leitura acumulada imediatamente anterior:

```text
variação = (leitura atual - leitura anterior) / leitura anterior × 100
```

Ambos tornam-se obrigatórios no formulário e na API quando a leitura aumentar
mais de:

```text
Energia elétrica -> 8%
Água              -> 5%
```

Quando não existir consumo anterior positivo, não há base percentual comparável
e motivo/observação permanecem opcionais.

A tabela de acompanhamento do dashboard exibe somente leituras cuja variação
ultrapasse o limite definido para o respectivo recurso.

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

O dashboard utiliza uma altura limitada ao espaço disponível no Adianti e
mantém barra de rolagem interna para acessar todo o conteúdo:

```html
<iframe
  id="consumo-dashboard"
  src="https://consumo-loja.vercel.app/dashboard.html?a_system_user_unit_code={$a_system_user_unit_code}&a_system_user_custom_code={$a_system_user_custom_code}"
  scrolling="yes"
  style="display:block; width:100%; height:calc(100vh - 90px); border:0;"
  title="Dashboard de consumo">
</iframe>
```

Não utilize o listener antigo de `consumo-loja:dashboard-height`, pois ele
expande o iframe e remove a necessidade da rolagem interna.

O código do funcionário recebido em `a_system_user_custom_code` é consultado no
Redis sincronizado. Funcionários ativos da categoria `DI` podem selecionar todas
as filiais com supervisor. Funcionários `SU` podem selecionar as filiais em que
são o supervisor. Funcionários `GR` permanecem limitados à filial do próprio
funcionário. Códigos ausentes ou inválidos permanecem limitados à filial
recebida do Adianti. Pagamentos e leituras validam novamente essa autorização na
API antes de retornar múltiplas filiais.

Para reduzir falhas transitórias do Firebird, o backend reaproveita as
permissões consultadas por alguns minutos e realiza novas tentativas de conexão
antes de informar indisponibilidade. O dashboard também realiza até cinco
tentativas silenciosas para consultas que retornarem indisponibilidade
temporária.

Quando não existe código de funcionário, a identificação de acesso usa
diretamente a filial do Adianti e não abre uma conexão adicional com o ERP.

Quando `a_system_user_custom_code` estiver vazio ou não for substituído pelo
Adianti, o dashboard tenta usar o funcionário salvo pelo login do formulário.
Se também não houver login salvo, nenhuma consulta multifilial será liberada e
o dashboard utiliza exclusivamente `a_system_user_unit_code`.

A projeção financeira é comparada com o último mês pago de cada recurso,
mostrando diferença em reais, percentual e se ficará acima ou abaixo. A tabela
de aumentos separa classificação do motivo, motivo informado e justificativa.

A tendência também compara o consumo projetado com a média de até três meses
recentes, destacando aumento em vermelho, redução em verde e estabilidade em
cinza.

Após a tabela de acompanhamento, o dashboard apresenta um gráfico de barras com
a média mensal paga de energia e água por filial selecionada. A média considera
somente as competências em que existe pagamento para o respectivo recurso.

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
## Admin

A página administrativa fica em:

```text
/admin.html
```

O acesso exige login com usuário e senha do FDC Web. Após validar o login no
Firebird, a API confere se o `IDFUNCIONARIO` está autorizado em:

```text
lib/admin-funcionarios.json
```

Exemplo:

```json
{
  "funcionariosPermitidos": ["123", "456"]
}
```

Pelo admin é possível alterar apelido, número e status dos relógios, além de
corrigir o valor de uma leitura lançada. Ao corrigir uma leitura, a próxima
leitura do mesmo contador tem seu `leitura_anterior` recalculado, e a data é
marcada novamente na fila `sincronizacao_firebird` para reenvio ao Firebird.
