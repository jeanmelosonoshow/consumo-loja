import {
  getDashboardAccess,
  queryFirebird,
  selectAuthorizedBranches,
} from "../lib/dashboard-access.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ message: "Método não permitido." });
  }

  try {
    const access = await getDashboardAccess(
      request.query.filial,
      request.query.funcionario,
    );
    const branches = selectAuthorizedBranches(access, request.query.filiais);
    const placeholders = branches.map(() => "?").join(",");
    const rows = await queryFirebird(`
      SELECT
        F.IDFILIAL, F.NOMEFILIAL, F.CIDADE, F.UF, P.IDCONTA, C.NOMECONTA,
        EXTRACT(YEAR FROM P.DATAEMISSAO) ANO_COMPETENCIA,
        EXTRACT(MONTH FROM P.DATAEMISSAO) MES_COMPETENCIA,
        SUM(IIF(PG.TIPOBAIXA IN ('4','5'), 0, PG.VALORBAIXA)) PAGAMENTO
      FROM PAGAR P
      JOIN PAGOS PG ON PG.IDFILIAL = P.IDFILIAL
        AND PG.NUMERODUPLICATA = P.NUMERODUPLICATA
      JOIN CONTA C ON C.IDCONTA = P.IDCONTA
      JOIN FILIAL F ON F.IDCENTROCUSTO = P.IDCENTROCUSTO
      WHERE P.STATUS IN ('1','2','0')
        AND P.IDCONTA IN ('1.02.01.03','1.02.01.02')
        AND P.DATAEMISSAO BETWEEN
          DATEADD(month, -6, CAST(EXTRACT(YEAR FROM CURRENT_DATE) || '/' ||
          EXTRACT(MONTH FROM CURRENT_DATE) || '/01' AS TIMESTAMP))
        AND DATEADD(month, +1, CAST(EXTRACT(YEAR FROM CURRENT_DATE) || '/' ||
          EXTRACT(MONTH FROM CURRENT_DATE) || '/01' AS TIMESTAMP)) - 1
        AND F.IDFILIAL IN (${placeholders})
      GROUP BY 1,2,3,4,5,6,7,8
      ORDER BY 7,8,1,6
    `, branches);
    const payments = rows.map(normalizePayment);
    const selectedMetadata = access.filiais.filter((branch) =>
      branches.includes(branch.codigo),
    );

    return response.status(200).json({
      filial: selectedMetadata.length === 1 ? selectedMetadata[0] : null,
      filiais: selectedMetadata,
      pagamentos: payments,
    });
  } catch (error) {
    console.error("Erro na consulta de pagamentos:", error);
    return response.status(error.statusCode ?? 500).json({
      message: error.statusCode
        ? error.message
        : "Não foi possível consultar os pagamentos no ERP.",
    });
  }
}

function normalizePayment(row) {
  return {
    filial: normalizeValue(row.IDFILIAL),
    nomeFilial: normalizeValue(row.NOMEFILIAL),
    cidade: normalizeValue(row.CIDADE),
    uf: normalizeValue(row.UF),
    idConta: normalizeValue(row.IDCONTA),
    nomeConta: classifyResource(row.IDCONTA) === "ENERGIA" ? "Energia elétrica" : "Água",
    recurso: classifyResource(row.IDCONTA),
    ano: Number(row.ANO_COMPETENCIA),
    mes: Number(row.MES_COMPETENCIA),
    pagamento: Number(row.PAGAMENTO ?? 0),
  };
}

function classifyResource(accountId) {
  return normalizeValue(accountId) === "1.02.01.03" ? "ENERGIA" : "AGUA";
}

function normalizeValue(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  return String(value ?? "").trim();
}
