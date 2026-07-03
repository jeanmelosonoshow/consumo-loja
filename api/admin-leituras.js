import { neon } from "@neondatabase/serverless";
import { handleAdminError, requireAdmin } from "../lib/admin-auth.js";

const CODIGO_FILIAL_VALIDO = /^[A-Za-z0-9._-]{1,30}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCH_READINGS = 800;

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
    if (request.method === "PATCH") return await updateReadings(request, response, sql);

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
    WHERE c.status = 'T'
      AND (${hasBranchFilter} = false OR l.idfilial_usr = ${filial})
      AND (${hasMeterFilter} = false OR l.id_contador = ${idContador})
      AND (${hasStartDate} = false OR l.data_leitura >= ${dataInicio}::date)
      AND (${hasEndDate} = false OR l.data_leitura <= ${dataFim}::date)
    ORDER BY l.data_leitura DESC, l.idfilial_usr, c.tipo_contador, c.apelido_contador
    LIMIT 800
  `;

  return response.status(200).json({ leituras: readings });
}

async function updateReadings(request, response, sql) {
  const submittedReadings = Array.isArray(request.body?.LEITURAS)
    ? request.body.LEITURAS
    : [{ ID_LEITURA: request.body?.ID_LEITURA, LEITURA: request.body?.LEITURA }];

  if (!submittedReadings.length || submittedReadings.length > MAX_BATCH_READINGS) {
    return response.status(400).json({ message: "Informe de 1 a 800 leituras para correção." });
  }

  const corrections = submittedReadings.map((reading) => ({
    id: Number(reading.ID_LEITURA),
    value: Number(reading.LEITURA),
  }));

  const invalidCorrection = corrections.find(
    (reading) => !Number.isInteger(reading.id) || reading.id <= 0 ||
      !Number.isFinite(reading.value) || !Number.isInteger(reading.value) || reading.value < 0,
  );

  if (invalidCorrection) {
    return response.status(400).json({
      message: "Todas as leituras devem ter ID válido e valor inteiro maior ou igual a zero.",
    });
  }

  const ids = [...new Set(corrections.map((reading) => reading.id))];
  if (ids.length !== corrections.length) {
    return response.status(400).json({ message: "A lista possui leitura repetida. Pesquise novamente antes de corrigir." });
  }

  const selectedReadings = await sql`
    SELECT
      l.id_leitura,
      l.idfilial_usr,
      l.id_contador,
      l.data_leitura,
      l.leitura,
      c.status AS status_contador
    FROM leitura_contador l
    JOIN cadastro_contador c
      ON c.id_contador = l.id_contador
    WHERE c.status = 'T'
      AND l.id_leitura = ANY(${ids}::bigint[])
    ORDER BY l.id_contador, l.data_leitura
  `;

  if (selectedReadings.length !== ids.length) {
    return response.status(404).json({
      message: "Uma ou mais leituras não foram encontradas ou pertencem a relógios inativos. Pesquise novamente.",
    });
  }

  const valueById = new Map(corrections.map((reading) => [reading.id, reading.value]));
  const groups = groupByMeter(selectedReadings);
  const updates = [];
  const nextReadingUpdates = [];
  const affectedDates = new Map();

  for (const readings of groups.values()) {
    const firstReading = readings[0];
    const lastReading = readings.at(-1);
    const [previousReading] = await sql`
      SELECT leitura
      FROM leitura_contador
      WHERE id_contador = ${firstReading.id_contador}
        AND data_leitura < ${dateKey(firstReading.data_leitura)}::date
      ORDER BY data_leitura DESC
      LIMIT 1
    `;
    const [nextReading] = await sql`
      SELECT id_leitura, idfilial_usr, id_contador, data_leitura, leitura
      FROM leitura_contador
      WHERE id_contador = ${lastReading.id_contador}
        AND data_leitura > ${dateKey(lastReading.data_leitura)}::date
      ORDER BY data_leitura ASC
      LIMIT 1
    `;

    let previousValue = previousReading?.leitura == null ? null : Number(previousReading.leitura);

    for (const reading of readings) {
      const newValue = valueById.get(Number(reading.id_leitura));
      if (previousValue != null && newValue < previousValue) {
        return response.status(422).json({
          message: `A leitura de ${formatDate(reading.data_leitura)} do contador ${reading.id_contador} não pode ser menor que a leitura anterior (${formatNumber(previousValue)}).`,
        });
      }

      updates.push({
        id: Number(reading.id_leitura),
        branch: reading.idfilial_usr,
        date: dateKey(reading.data_leitura),
        value: newValue,
        previousValue,
      });
      addAffectedDate(affectedDates, reading.idfilial_usr, reading.data_leitura);
      previousValue = newValue;
    }

    const nextValue = nextReading?.leitura == null ? null : Number(nextReading.leitura);
    if (nextValue != null && previousValue > nextValue) {
      return response.status(422).json({
        message: `A última leitura corrigida do contador ${lastReading.id_contador} não pode ser maior que a próxima leitura registrada (${formatNumber(nextValue)} em ${formatDate(nextReading.data_leitura)}).`,
      });
    }

    if (nextReading) {
      nextReadingUpdates.push({
        id: Number(nextReading.id_leitura),
        meterId: Number(nextReading.id_contador),
        branch: nextReading.idfilial_usr,
        date: dateKey(nextReading.data_leitura),
        previousValue,
      });
      addAffectedDate(affectedDates, nextReading.idfilial_usr, nextReading.data_leitura);
    }
  }

  const queries = updates.map((reading) => sql`
    UPDATE leitura_contador
       SET leitura = ${reading.value},
           leitura_anterior = ${reading.previousValue}
     WHERE id_leitura = ${reading.id}
     RETURNING
       id_leitura AS "ID_LEITURA",
       idfilial_usr AS "IDFILIAL_USR",
       id_contador AS "ID_CONTADOR",
       data_leitura AS "DATA_LEITURA",
       leitura AS "LEITURA",
       leitura_anterior AS "LEITURA_ANTERIOR",
       data_registro AS "DATA_REGISTRO"
  `);

  for (const reading of nextReadingUpdates) {
    queries.push(sql`
      UPDATE leitura_contador
         SET leitura_anterior = ${reading.previousValue}
       WHERE id_leitura = ${reading.id}
         AND id_contador = ${reading.meterId}
    `);
  }

  const [syncTable] = await sql`
    SELECT to_regclass('public.sincronizacao_firebird') IS NOT NULL AS existe
  `;

  if (syncTable?.existe) {
    for (const [key, item] of affectedDates) {
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
          ${item.branch},
          ${item.date},
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

  const results = await sql.transaction(queries);
  const correctedReadings = results.slice(0, updates.length).flat();

  return response.status(200).json({
    message: `${correctedReadings.length} leitura(s) corrigida(s) com sucesso. ${
      nextReadingUpdates.length
        ? `${nextReadingUpdates.length} próxima(s) leitura(s) tiveram a leitura anterior atualizada.`
        : "Não havia leitura posterior para atualizar."
    }`,
    leituras: correctedReadings,
    proximasLeiturasAtualizadas: nextReadingUpdates.length,
  });
}

function groupByMeter(readings) {
  const groups = new Map();
  for (const reading of readings) {
    const key = Number(reading.id_contador);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(reading);
  }
  return groups;
}

function addAffectedDate(map, branch, date) {
  const item = { branch, date: dateKey(date) };
  map.set(`${item.branch}|${item.date}`, item);
}

function dateKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return text.slice(0, 10);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}
