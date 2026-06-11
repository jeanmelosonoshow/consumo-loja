import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Firebird = require("node-firebird");
const CODIGO_FILIAL_VALIDO = /^[A-Z0-9]{2}$/;

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ message: "Método não permitido." });
  }

  const filial = normalizeBranch(request.query.filial);

  if (!CODIGO_FILIAL_VALIDO.test(filial)) {
    return response.status(400).json({ message: "Código da filial inválido." });
  }

  const requiredVariables = [
    "DB_HOST_FB",
    "DB_PORT_FB",
    "DB_PATH_FB",
    "DB_USER_FB",
    "DB_PASSWORD_FB",
  ];

  if (requiredVariables.some((name) => !process.env[name])) {
    return response.status(500).json({
      message: "A conexão com o ERP não está configurada neste projeto.",
    });
  }

  const options = {
    host: process.env.DB_HOST_FB,
    port: Number(process.env.DB_PORT_FB),
    database: process.env.DB_PATH_FB,
    user: process.env.DB_USER_FB,
    password: process.env.DB_PASSWORD_FB,
    lowercase_keys: false,
    pageSize: 4096,
  };

  return new Promise((resolve) => {
    Firebird.attach(options, (connectionError, database) => {
      if (connectionError) {
        console.error("Erro ao conectar no Firebird:", connectionError);
        response.status(503).json({ message: "Não foi possível conectar ao ERP." });
        return resolve();
      }

      const sql = `
        SELECT
          F.IDFILIAL,
          F.NOMEFILIAL,
          F.CIDADE,
          F.UF,
          P.IDCONTA,
          C.NOMECONTA,
          EXTRACT(YEAR FROM P.DATAEMISSAO) ANO_COMPETENCIA,
          EXTRACT(MONTH FROM P.DATAEMISSAO) MES_COMPETENCIA,
          SUM(IIF(PG.TIPOBAIXA IN ('4','5'), 0, PG.VALORBAIXA)) PAGAMENTO
        FROM PAGAR P
        JOIN PAGOS PG
          ON PG.IDFILIAL = P.IDFILIAL
         AND PG.NUMERODUPLICATA = P.NUMERODUPLICATA
        JOIN CONTA C ON C.IDCONTA = P.IDCONTA
        JOIN FILIAL F ON F.IDCENTROCUSTO = P.IDCENTROCUSTO
        WHERE P.STATUS IN ('1','2','0')
          AND P.IDCONTA IN ('1.02.01.03','1.02.01.02')
          AND P.DATAEMISSAO BETWEEN
              DATEADD(month, -6, CAST(
                EXTRACT(YEAR FROM CURRENT_DATE) || '/' ||
                EXTRACT(MONTH FROM CURRENT_DATE) || '/01'
                AS TIMESTAMP
              ))
          AND DATEADD(month, +1, CAST(
                EXTRACT(YEAR FROM CURRENT_DATE) || '/' ||
                EXTRACT(MONTH FROM CURRENT_DATE) || '/01'
                AS TIMESTAMP
              )) - 1
          AND F.IDFILIAL = ?
        GROUP BY 1,2,3,4,5,6,7,8
        ORDER BY 7,8,6
      `;

      database.query(sql, [filial], (queryError, rows) => {
        database.detach();

        if (queryError) {
          console.error("Erro na consulta de pagamentos:", queryError);
          response.status(500).json({
            message: "Não foi possível consultar os pagamentos no ERP.",
          });
          return resolve();
        }

        const normalizedRows = (rows ?? []).map((row) => ({
          filial: normalizeValue(row.IDFILIAL),
          nomeFilial: normalizeValue(row.NOMEFILIAL),
          cidade: normalizeValue(row.CIDADE),
          uf: normalizeValue(row.UF),
          idConta: normalizeValue(row.IDCONTA),
          nomeConta: normalizeValue(row.NOMECONTA),
          recurso: classifyResource(row.NOMECONTA),
          ano: Number(row.ANO_COMPETENCIA),
          mes: Number(row.MES_COMPETENCIA),
          pagamento: Number(row.PAGAMENTO ?? 0),
        }));

        response.status(200).json({
          filial: normalizedRows[0]
            ? {
                codigo: normalizedRows[0].filial,
                nome: normalizedRows[0].nomeFilial,
                cidade: normalizedRows[0].cidade,
                uf: normalizedRows[0].uf,
              }
            : { codigo: filial },
          pagamentos: normalizedRows,
        });
        return resolve();
      });
    });
  });
}

function normalizeBranch(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeValue(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  return String(value ?? "").trim();
}

function classifyResource(name) {
  const normalized = normalizeValue(name).toUpperCase();
  if (normalized.includes("AGUA") || normalized.includes("ÁGUA")) return "AGUA";
  if (
    normalized.includes("ENERG") ||
    normalized.includes("ELETR") ||
    normalized.includes("LUZ")
  ) {
    return "ENERGIA";
  }
  return "OUTRO";
}
