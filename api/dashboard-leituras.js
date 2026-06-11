import { neon } from "@neondatabase/serverless";
import {
  getDashboardAccess,
  selectAuthorizedBranches,
} from "./_dashboard-access.js";

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
      WITH consumos AS (
        SELECT
          l.id_leitura,
          l.idfilial_usr,
          l.id_contador,
          c.apelido_contador,
          c.tipo_contador,
          l.data_leitura,
          l.leitura,
          l.leitura_anterior,
          NULLIF(to_jsonb(l)->>'motivo', '') AS motivo,
          NULLIF(to_jsonb(l)->>'observacao', '') AS observacao,
          CASE
            WHEN l.leitura_anterior IS NULL THEN NULL
            ELSE l.leitura - l.leitura_anterior
          END AS consumo
        FROM leitura_contador l
        JOIN cadastro_contador c ON c.id_contador = l.id_contador
        WHERE l.idfilial_usr = ANY(${branches}::text[])
          AND l.data_leitura >= CURRENT_DATE - INTERVAL '7 months'
      ),
      comparados AS (
        SELECT
          *,
          LAG(consumo) OVER (
            PARTITION BY id_contador
            ORDER BY data_leitura
          ) AS consumo_anterior
        FROM consumos
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
      FROM comparados
      ORDER BY data_leitura, tipo_contador, apelido_contador
    `;

    return response.status(200).json({ filiais: branches, leituras: readings });
  } catch (error) {
    console.error("Erro no dashboard de leituras:", error);
    return response.status(error.statusCode ?? 500).json({
      message: error.statusCode
        ? error.message
        : "Não foi possível consultar as leituras registradas.",
    });
  }
}
