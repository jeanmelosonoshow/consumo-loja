import { neon } from "@neondatabase/serverless";
import { handleAdminError, requireAdmin } from "../lib/admin-auth.js";

const CODIGO_FILIAL_VALIDO = /^[A-Za-z0-9._-]{1,30}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(request, response) {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    return response.status(500).json({ message: "A conexão com o banco de dados não está configurada." });
  }

  try {
    requireAdmin(request);
    const sql = neon(connectionString);

    if (request.method === "GET") return await listReadings(request, response, sql);
    if (request.method === "PATCH") return await updateReading(request, response, sql);

    response.setHeader("Allow", "GET, PATCH");
    return response.status(405).json({ message: "Método não permitido." });
  } catch (error) {
    return handleAdminError(error, response);
  }
}

async function listReadings(request, response, sql) {
  const filial = normalizeText(request.query.filial).toUpperCase();
  const idContador = Number(request.query.idContador ?? 0);
  const dataInicio = normalizeText(request.query.dataInicio);
  const dataFim = normalizeText(request.query.dataFim);
  const hasBranchFilter = filial !== "";
  const hasMeterFilter = Number.isInteger(idContador) && idContador > 0;
  const hasStartDate = dataInicio !== "";
  const hasEndDate = dataFim !== "";

  if (hasBranchFilter && !CODIGO_FILIAL_VALIDO.test(filial)) {
    return response.status(400).json({ message: "Código da filial inválido." });
  }
  if (hasStartDate && !DATA_VALIDA.test(dataInicio)) {
    return response.status(400).json({ message: "Data inicial inválida." });
  }
  if (hasEndDate && !DATA_VALIDA.test(dataFim)) {
    return response.status(400).json({ message: "Data final inválida." });
  }

  const readings = await sql`
    SELECT
      l.id_leitura AS "ID_LEITURA",
      l.idfilial_usr AS "IDFILIAL_USR",
      l.id_contador AS "ID_CONTADOR",
      c.apelido_contador AS "APELIDO_CONTADOR",
      c.numero_contador AS "NUMERO_CONTADOR",
      c.tipo_contador AS "TIPO_CONTADOR",
      c.status AS "STATUS_CONTADOR",
      l.data_leitura AS "DATA_LEITURA",
      l.leitura AS "LEITURA",
      l.leitura_anterior AS "LEITURA_ANTERIOR",
      l.data_registro AS "DATA_REGISTRO"
    FROM leitura_contador l
    JOIN cadastro_contador c
      ON c.id_contador = l.id_contador
    WHERE (${hasBranchFilter} = false OR l.idfilial_usr = ${filial})
      AND (${hasMeterFilter} = false OR l.id_contador = ${idContador})
      AND (${hasStartDate} = false OR l.data_leitura >= ${dataInicio}::date)
      AND (${hasEndDate} = false OR l.data_leitura <= ${dataFim}::date)
    ORDER BY l.data_leitura DESC, l.idfilial_usr, c.tipo_contador, c.apelido_contador
    LIMIT 800
  `;

  return response.status(200).json({ leituras: readings });
}

async function updateReading(request, response, sql) {
  const id = Number(request.body?.ID_LEITURA);
  const value = Number(request.body?.LEITURA);

  if (!Number.isInteger(id) || id <= 0) {
    return response.status(400).json({ message: "Leitura inválida." });
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return response.status(400).json({ message: "Informe um valor de leitura inteiro e maior ou igual a zero." });
  }

  const [current] = await sql`
    SELECT
      l.id_leitura,
      l.idfilial_usr,
      l.id_contador,
      l.data_leitura,
      l.leitura,
      anterior.leitura AS leitura_anterior_calculada,
      proxima.id_leitura AS id_proxima_leitura,
      proxima.data_leitura AS data_proxima_leitura,
      proxima.leitura AS proxima_leitura
    FROM leitura_contador l
    LEFT JOIN LATERAL (
      SELECT leitura
      FROM leitura_contador la
      WHERE la.id_contador = l.id_contador
        AND la.data_leitura < l.data_leitura
      ORDER BY la.data_leitura DESC
      LIMIT 1
    ) anterior ON TRUE
    LEFT JOIN LATERAL (
      SELECT id_leitura, data_leitura, leitura
      FROM leitura_contador lp
      WHERE lp.id_contador = l.id_contador
        AND lp.data_leitura > l.data_leitura
      ORDER BY lp.data_leitura ASC
      LIMIT 1
    ) proxima ON TRUE
    WHERE l.id_leitura = ${id}
  `;

  if (!current) return response.status(404).json({ message: "Leitura não encontrada." });

  const previousValue = current.leitura_anterior_calculada == null
    ? null
    : Number(current.leitura_anterior_calculada);
  const nextValue = current.proxima_leitura == null
    ? null
    : Number(current.proxima_leitura);

  if (previousValue != null && value < previousValue) {
    return response.status(422).json({
      message: `A leitura corrigida não pode ser menor que a leitura anterior (${formatNumber(previousValue)}).`,
    });
  }

  if (nextValue != null && value > nextValue) {
    return response.status(422).json({
      message: `A leitura corrigida não pode ser maior que a próxima leitura (${formatNumber(nextValue)}).`,
    });
  }

  const queries = [
    sql`
      UPDATE leitura_contador
         SET leitura = ${value},
             leitura_anterior = ${previousValue}
       WHERE id_leitura = ${id}
       RETURNING
         id_leitura AS "ID_LEITURA",
         idfilial_usr AS "IDFILIAL_USR",
         id_contador AS "ID_CONTADOR",
         data_leitura AS "DATA_LEITURA",
         leitura AS "LEITURA",
         leitura_anterior AS "LEITURA_ANTERIOR",
         data_registro AS "DATA_REGISTRO"
    `,
  ];

  if (current.id_proxima_leitura) {
    queries.push(sql`
      UPDATE leitura_contador
         SET leitura_anterior = ${value}
       WHERE id_leitura = ${current.id_proxima_leitura}
    `);
  }

  const [syncTable] = await sql`
    SELECT to_regclass('public.sincronizacao_firebird') IS NOT NULL AS existe
  `;

  if (syncTable?.existe) {
    const affectedDates = [current.data_leitura, current.data_proxima_leitura]
      .filter(Boolean)
      .map((date) => String(date).slice(0, 10));

    for (const date of [...new Set(affectedDates)]) {
      queries.push(sql`
        INSERT INTO sincronizacao_firebird (
          idfilial_usr,
          data_leitura,
          status,
          tentativas,
          data_ultima_tentativa,
          data_sincronizacao,
          mensagem_erro
        )
        VALUES (
          ${current.idfilial_usr},
          ${date},
          'PENDENTE',
          0,
          NULL,
          NULL,
          'Correção administrativa pendente de sincronização.'
        )
        ON CONFLICT (idfilial_usr, data_leitura)
        DO UPDATE SET
          status = 'PENDENTE',
          tentativas = 0,
          data_ultima_tentativa = NULL,
          data_sincronizacao = NULL,
          mensagem_erro = 'Correção administrativa pendente de sincronização.'
      `);
    }
  }

  const result = await sql.transaction(queries);
  return response.status(200).json({
    message: "Leitura corrigida com sucesso.",
    leitura: result[0][0],
  });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}
