import { queryFirebird } from "./dashboard-access.js";

export async function findCompletedReadingDates(sql, filial, requestedDates = []) {
  const dates = requestedDates.filter(Boolean);
  const completed = await sql`
    WITH ativos AS (
      SELECT COUNT(*)::int AS quantidade
      FROM cadastro_contador
      WHERE idfilial_usr = ${filial}
        AND status = 'T'
    )
    SELECT TO_CHAR(l.data_leitura, 'YYYY-MM-DD') AS data_leitura
    FROM leitura_contador l
    JOIN cadastro_contador c ON c.id_contador = l.id_contador
    CROSS JOIN ativos
    WHERE l.idfilial_usr = ${filial}
      AND c.status = 'T'
      AND ativos.quantidade > 0
      AND (
        ${dates.length === 0}
        OR l.data_leitura = ANY(${dates}::date[])
      )
    GROUP BY l.data_leitura, ativos.quantidade
    HAVING COUNT(DISTINCT l.id_contador) = ativos.quantidade
    ORDER BY l.data_leitura
  `;

  return completed.map((item) => item.data_leitura);
}

export async function syncCompletedDatesToFirebird(filial, dates) {
  const synchronized = [];

  for (const date of dates) {
    await queryFirebird(
      `
        INSERT INTO CONTROLE_LEITURA_CONSUMO (
          IDFILIAL,
          DATA_LEITURA
        )
        SELECT ?, CAST(? AS DATE)
        FROM RDB$DATABASE
        WHERE NOT EXISTS (
          SELECT 1
          FROM CONTROLE_LEITURA_CONSUMO C
          WHERE C.IDFILIAL = ?
            AND C.DATA_LEITURA = CAST(? AS DATE)
        )
      `,
      [filial, date, filial, date],
    );
    synchronized.push(date);
  }

  return synchronized;
}
