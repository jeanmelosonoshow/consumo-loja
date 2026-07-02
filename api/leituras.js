import { neon } from "@neondatabase/serverless";

const CODIGO_FILIAL_VALIDO = /^[A-Za-z0-9._-]{1,30}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(request, response) {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    return response.status(500).json({
      message: "A conexão com o banco de dados não está configurada.",
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ message: "Método não permitido." });
  }

  const sql = neon(connectionString);

  try {
    return await createReadings(request, response, sql);
  } catch (error) {
    console.error("Erro na API de leituras:", error);

    if (error.code === "23505") {
      return response.status(409).json({
        message:
          "Já existe uma leitura para um dos contadores na data informada. Nenhuma leitura foi gravada.",
      });
    }

    if (error.code === "23514") {
      return response.status(422).json({
        message: `${cleanDatabaseMessage(error.message)} Nenhuma leitura foi gravada.`,
      });
    }

    if (error.code === "42P01") {
      return response.status(500).json({
        message: "A tabela leitura_contador ainda não existe no banco.",
      });
    }

    return response.status(500).json({
      message: "Não foi possível gravar as leituras. Nenhuma leitura foi gravada.",
    });
  }
}

async function createReadings(request, response, sql) {
  const filial = normalizeText(request.body?.IDFILIAL_USR);
  const readings = request.body?.LEITURAS;

  if (!CODIGO_FILIAL_VALIDO.test(filial)) {
    return response.status(400).json({ message: "Código da filial inválido." });
  }

  if (!Array.isArray(readings) || readings.length === 0) {
    return response.status(400).json({
      message: "Informe as leituras de todos os contadores ativos.",
    });
  }

  const activeMeters = await sql`
    SELECT
      id_contador::text AS id_contador,
      tipo_contador
    FROM cadastro_contador
    WHERE idfilial_usr = ${filial}
      AND status = 'T'
    ORDER BY id_contador
  `;
  const activeIds = activeMeters.map((meter) => meter.id_contador);
  const meterTypes = new Map(
    activeMeters.map((meter) => [meter.id_contador, meter.tipo_contador]),
  );
  const receivedIds = readings.map((reading) => String(reading.ID_CONTADOR));
  const uniqueReceivedIds = new Set(receivedIds);

  if (
    activeIds.length !== readings.length ||
    uniqueReceivedIds.size !== readings.length ||
    activeIds.some((id) => !uniqueReceivedIds.has(id))
  ) {
    return response.status(400).json({
      message:
        "É obrigatório informar exatamente uma leitura para cada contador ativo da filial.",
    });
  }

  for (const reading of readings) {
    const date = normalizeText(reading.DATA_LEITURA);
    const value = Number(reading.LEITURA);

    if (
      !DATA_VALIDA.test(date) ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return response.status(400).json({
        message:
          "Uma ou mais leituras possuem data inválida ou valor que não é um número inteiro.",
      });
    }
  }

  const justificationColumns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'leitura_contador'
      AND column_name IN ('motivo', 'observacao')
  `;
  const canSaveJustification =
    justificationColumns.some((column) => column.column_name === "motivo") &&
    justificationColumns.some((column) => column.column_name === "observacao");

  if (canSaveJustification) {
    for (const reading of readings) {
      const [comparison] = await sql`
        WITH anteriores AS (
          SELECT
            leitura,
            data_leitura,
            LAG(leitura) OVER (
              ORDER BY data_leitura
            ) AS leitura_anterior_da_anterior
          FROM leitura_contador
          WHERE id_contador = ${String(reading.ID_CONTADOR)}
            AND data_leitura < ${normalizeText(reading.DATA_LEITURA)}
        )
        SELECT
          leitura AS ultima_leitura,
          leitura - leitura_anterior_da_anterior AS consumo_anterior
        FROM anteriores
        ORDER BY data_leitura DESC
        LIMIT 1
      `;
      const newValue = Number(reading.LEITURA);
      const reason = normalizeOptionalText(reading.MOTIVO, 120);
      const observation = normalizeOptionalText(reading.OBSERVACAO, 500);
      const previousReading = Number(comparison?.ultima_leitura);
      const previousConsumption = Number(comparison?.consumo_anterior);
      const currentConsumption =
        comparison?.ultima_leitura != null ? newValue - previousReading : null;
      const resource = meterTypes.get(String(reading.ID_CONTADOR));
      const increaseLimit = resource === "ENERGIA" ? 8 : 5;
      const increasePercentage =
        currentConsumption != null &&
        Number.isFinite(previousConsumption) &&
        previousConsumption > 0
          ? ((currentConsumption - previousConsumption) / previousConsumption) * 100
          : null;
      const requiresJustification =
        increasePercentage != null && increasePercentage > increaseLimit;

      if (requiresJustification && (!reason || !observation)) {
        return response.status(422).json({
          message: `Foi identificado aumento superior a ${increaseLimit}% no consumo de ${
            resource === "ENERGIA" ? "energia" : "água"
          }. Informe motivo e observação.`,
        });
      }
    }
  }

  const queries = readings.map((reading) => {
    const meterId = String(reading.ID_CONTADOR);
    const date = normalizeText(reading.DATA_LEITURA);
    const value = Number(reading.LEITURA);
    const reason = normalizeOptionalText(reading.MOTIVO, 120);
    const observation = normalizeOptionalText(reading.OBSERVACAO, 500);

    if (canSaveJustification) {
      return sql`
        INSERT INTO leitura_contador (
          idfilial_usr,
          id_contador,
          data_leitura,
          leitura,
          motivo,
          observacao
        )
        VALUES (
          ${filial},
          ${meterId},
          ${date},
          ${value},
          ${reason},
          ${observation}
        )
        RETURNING
          id_leitura AS "ID_LEITURA",
          id_contador AS "ID_CONTADOR",
          data_leitura AS "DATA_LEITURA",
          leitura AS "LEITURA",
          leitura_anterior AS "LEITURA_ANTERIOR",
          motivo AS "MOTIVO",
          observacao AS "OBSERVACAO",
          data_registro AS "DATA_REGISTRO"
      `;
    }

    return sql`
      INSERT INTO leitura_contador (
        idfilial_usr,
        id_contador,
        data_leitura,
        leitura
      )
      VALUES (${filial}, ${meterId}, ${date}, ${value})
      RETURNING
        id_leitura AS "ID_LEITURA",
        id_contador AS "ID_CONTADOR",
        data_leitura AS "DATA_LEITURA",
        leitura AS "LEITURA",
        leitura_anterior AS "LEITURA_ANTERIOR",
        data_registro AS "DATA_REGISTRO"
    `;
  });

  const requestedDates = [
    ...new Set(readings.map((reading) => normalizeText(reading.DATA_LEITURA))),
  ];
  const [syncTable] = await sql`
    SELECT to_regclass('public.sincronizacao_firebird') IS NOT NULL AS existe
  `;
  if (syncTable?.existe) {
    queries.push(sql`
      INSERT INTO sincronizacao_firebird (
        idfilial_usr,
        data_leitura
      )
      SELECT
        l.idfilial_usr,
        l.data_leitura
      FROM leitura_contador l
      JOIN cadastro_contador c
        ON c.id_contador = l.id_contador
      WHERE l.idfilial_usr = ${filial}
        AND c.status = 'T'
        AND l.data_leitura = ANY(${requestedDates}::date[])
      GROUP BY
        l.idfilial_usr,
        l.data_leitura
      HAVING COUNT(DISTINCT l.id_contador) = (
        SELECT COUNT(*)
        FROM cadastro_contador ca
        WHERE ca.idfilial_usr = l.idfilial_usr
          AND ca.status = 'T'
      )
      ON CONFLICT (idfilial_usr, data_leitura) DO NOTHING
      RETURNING id_sincronizacao AS "ID_SINCRONIZACAO"
    `);
  }

  const results = await sql.transaction(queries);
  const savedReadings = results.slice(0, readings.length).flat();
  const createdSynchronizations = syncTable?.existe
    ? results.at(-1)?.length ?? 0
    : null;

  return response.status(201).json({
    message: `${savedReadings.length} leitura(s) gravada(s) com sucesso. ${
      createdSynchronizations === null
        ? "O controle de sincronização ainda não está habilitado."
        : createdSynchronizations
        ? "Dia completo preparado para sincronização."
        : "Nenhuma nova sincronização pendente foi necessária."
    }`,
    readings: savedReadings,
  });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value, maxLength) {
  const normalized = normalizeText(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function cleanDatabaseMessage(message) {
  return String(message).split("\n")[0].replace(/^.*?:\s*/, "");
}
