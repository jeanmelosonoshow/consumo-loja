import { neon } from "@neondatabase/serverless";

const CODIGO_FILIAL_VALIDO = /^[A-Z0-9]{2}$/;

// Valores externos conservadores para simulação inicial. Sempre cedem
// prioridade a uma tarifa válida cadastrada na tabela tarifa_referencia.
const INTERNET_FALLBACKS = {
  RJ: {
    ENERGIA: {
      concessionaria: "Média genérica RJ (Light / Enel Rio)",
      valorUnitario: 1.2,
      unidade: "R$/kWh",
      dataInicio: "2026-01-01",
      fonteUrl: "https://www.gov.br/aneel/pt-br/assuntos/tarifas",
    },
    AGUA: {
      concessionaria: "Média genérica RJ (Águas do Rio / CEDAE)",
      valorUnitario: 12,
      unidade: "R$/m³",
      dataInicio: "2026-01-01",
      fonteUrl: "https://www.gov.br/ana/pt-br/assuntos/saneamento-basico",
    },
  },
};

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ message: "Método não permitido." });
  }

  const filial = normalize(request.query.filial);
  const uf = normalize(request.query.uf);
  const cidade = normalizeCity(request.query.cidade);

  if (!CODIGO_FILIAL_VALIDO.test(filial) || !/^[A-Z]{2}$/.test(uf)) {
    return response.status(400).json({
      message: "Filial ou UF inválida para consulta de tarifas.",
    });
  }

  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    return response.status(500).json({
      message: "A conexão com o banco de dados não está configurada.",
    });
  }

  const sql = neon(connectionString);

  try {
    const tableExists = await sql`
      SELECT to_regclass('public.tarifa_referencia') IS NOT NULL AS existe
    `;
    const databaseRates = tableExists[0]?.existe
      ? await findDatabaseRates(sql, uf, cidade)
      : [];
    const rates = ["ENERGIA", "AGUA"].map((resource) => {
      const databaseRate = databaseRates.find(
        (rate) => rate.RECURSO === resource,
      );

      if (databaseRate) {
        return {
          recurso: resource,
          concessionaria: databaseRate.CONCESSIONARIA,
          valorUnitario: Number(databaseRate.VALOR_UNITARIO),
          unidade: databaseRate.UNIDADE,
          dataInicio: databaseRate.DATA_INICIO,
          fonteUrl: databaseRate.FONTE_URL,
          origem: "BANCO",
        };
      }

      const fallback = INTERNET_FALLBACKS[uf]?.[resource];
      return fallback
        ? { recurso: resource, ...fallback, origem: "INTERNET_FALLBACK" }
        : { recurso: resource, origem: "INDISPONIVEL" };
    });

    return response.status(200).json({ filial, uf, cidade, tarifas: rates });
  } catch (error) {
    console.error("Erro na consulta de tarifas:", error);
    return response.status(500).json({
      message: "Não foi possível consultar as tarifas de referência.",
    });
  }
}

async function findDatabaseRates(sql, uf, cidade) {
  return sql`
    SELECT DISTINCT ON (recurso)
      recurso AS "RECURSO",
      concessionaria AS "CONCESSIONARIA",
      valor_unitario AS "VALOR_UNITARIO",
      unidade AS "UNIDADE",
      data_inicio AS "DATA_INICIO",
      fonte_url AS "FONTE_URL"
    FROM tarifa_referencia
    WHERE uf = ${uf}
      AND status = 'T'
      AND data_inicio <= CURRENT_DATE
      AND (data_fim IS NULL OR data_fim >= CURRENT_DATE)
      AND (cidade IS NULL OR UPPER(TRIM(cidade)) = ${cidade})
    ORDER BY
      recurso,
      CASE WHEN cidade IS NULL THEN 1 ELSE 0 END,
      data_inicio DESC
  `;
}

function normalize(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeCity(value) {
  return normalize(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
