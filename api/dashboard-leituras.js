import { neon } from "@neondatabase/serverless";
import {
  getDashboardAccess,
  selectAuthorizedBranches,
} from "../lib/dashboard-access.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ message: "Método não permitido." });
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
    const access = await getDashboardAccess(
      request.query.filial,
      request.query.funcionario,
    );
    const branches = selectAuthorizedBranches(access, request.query.filiais);
    const readings = await sql`
      WITH leituras_ordenadas AS (
        SELECT
          l.id_leitura,
          l.idfilial_usr,
          l.id_contador,
          c.apelido_contador,
          c.tipo_contador,
          l.data_leitura,
          l.leitura,
          NULLIF(to_jsonb(l)->>'motivo', '') AS motivo,
          NULLIF(to_jsonb(l)->>'observacao', '') AS observacao,
          LAG(l.leitura) OVER (
            PARTITION BY l.id_contador
            ORDER BY l.data_leitura
          ) AS leitura_anterior,
          LAG(l.leitura, 2) OVER (
            PARTITION BY l.id_contador
            ORDER BY l.data_leitura
          ) AS leitura_anterior_da_anterior
        FROM leitura_contador l
        JOIN cadastro_contador c
          ON c.id_contador = l.id_contador
         AND c.idfilial_usr = l.idfilial_usr
        WHERE l.idfilial_usr = ANY(${branches}::text[])
          AND c.status = 'T'
      ),
      consumos AS (
        SELECT
          id_leitura,
          idfilial_usr,
          id_contador,
          apelido_contador,
          tipo_contador,
          data_leitura,
          leitura,
          leitura_anterior,
          motivo,
          observacao,
          CASE
            WHEN leitura_anterior IS NULL THEN NULL
            ELSE leitura - leitura_anterior
          END AS consumo,
          CASE
            WHEN leitura_anterior IS NULL
              OR leitura_anterior_da_anterior IS NULL THEN NULL
            ELSE leitura_anterior - leitura_anterior_da_anterior
          END AS consumo_anterior
        FROM leituras_ordenadas
        WHERE data_leitura >= CURRENT_DATE - INTERVAL '7 months'
      )
      SELECT
        id_leitura AS "ID_LEITURA",
        idfilial_usr AS "IDFILIAL_USR",
        id_contador AS "ID_CONTADOR",
        apelido_contador AS "APELIDO_CONTADOR",
        tipo_contador AS "TIPO_CONTADOR",
        data_leitura AS "DATA_LEITURA",
        leitura AS "LEITURA",
        leitura_anterior AS "LEITURA_ANTERIOR",
        consumo AS "CONSUMO",
        consumo_anterior AS "CONSUMO_ANTERIOR",
        motivo AS "MOTIVO",
        observacao AS "OBSERVACAO",
        CASE
          WHEN consumo_anterior IS NULL OR consumo_anterior = 0 THEN NULL
          ELSE ROUND(((consumo - consumo_anterior) / consumo_anterior) * 100, 2)
        END AS "VARIACAO_PERCENTUAL"
      FROM consumos
      ORDER BY data_leitura, tipo_contador, apelido_contador
    `;
    const missingReadings = await sql`
      WITH filiais_selecionadas AS (
        SELECT UNNEST(${branches}::text[]) AS idfilial_usr
      ),
      contadores_ativos AS (
        SELECT
          c.idfilial_usr,
          c.id_contador,
          c.data_cadastro::date AS data_cadastro
        FROM cadastro_contador c
        JOIN filiais_selecionadas fs
          ON fs.idfilial_usr = c.idfilial_usr
        WHERE c.status = 'T'
      ),
      resumo_contadores AS (
        SELECT
          idfilial_usr,
          COUNT(*) AS contadores_ativos,
          MIN(data_cadastro) AS primeira_data_contador
        FROM contadores_ativos
        GROUP BY idfilial_usr
      ),
      calendario AS (
        SELECT
          r.idfilial_usr,
          dia::date AS data_leitura,
          r.contadores_ativos
        FROM resumo_contadores r
        CROSS JOIN LATERAL GENERATE_SERIES(
          GREATEST(DATE_TRUNC('month', CURRENT_DATE)::date, r.primeira_data_contador),
          CURRENT_DATE,
          INTERVAL '1 day'
        ) AS dia
      ),
      leituras_dia AS (
        SELECT
          l.idfilial_usr,
          l.data_leitura,
          COUNT(DISTINCT l.id_contador) AS leituras_registradas
        FROM leitura_contador l
        JOIN contadores_ativos c
          ON c.idfilial_usr = l.idfilial_usr
         AND c.id_contador = l.id_contador
        WHERE l.data_leitura >= DATE_TRUNC('month', CURRENT_DATE)::date
          AND l.data_leitura <= CURRENT_DATE
        GROUP BY l.idfilial_usr, l.data_leitura
      )
      SELECT
        c.idfilial_usr AS "IDFILIAL_USR",
        c.data_leitura AS "DATA_LEITURA",
        c.contadores_ativos AS "CONTADORES_ATIVOS",
        COALESCE(l.leituras_registradas, 0) AS "LEITURAS_REGISTRADAS"
      FROM calendario c
      LEFT JOIN leituras_dia l
        ON l.idfilial_usr = c.idfilial_usr
       AND l.data_leitura = c.data_leitura
      WHERE COALESCE(l.leituras_registradas, 0) < c.contadores_ativos
      ORDER BY c.idfilial_usr, c.data_leitura
    `;
    const meterBranches = await sql`
      SELECT
        c.idfilial_usr AS "IDFILIAL_USR",
        COUNT(*) AS "CONTADORES_ATIVOS"
      FROM cadastro_contador c
      WHERE c.idfilial_usr = ANY(${branches}::text[])
        AND c.status = 'T'
      GROUP BY c.idfilial_usr
      ORDER BY c.idfilial_usr
    `;

    return response.status(200).json({
      filiais: branches,
      leituras: readings,
      faltas: missingReadings,
      filiaisComContador: meterBranches,
    });
  } catch (error) {
    console.error("Erro no dashboard de leituras:", error);
    return response.status(error.statusCode ?? 500).json({
      message: error.statusCode
        ? error.message
        : "Não foi possível consultar as leituras registradas.",
    });
  }
}
