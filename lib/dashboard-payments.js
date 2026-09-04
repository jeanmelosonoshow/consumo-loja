import { canUseDirectFirebird } from "./firebird-cache-config.js";
import { AccessError, queryFirebird } from "./dashboard-access.js";
import {
  cacheTtlSeconds,
  createCacheKey,
  getJsonCacheEntry,
  getStaleJsonCache,
  setJsonCache,
} from "./redis-cache.js";

const DASHBOARD_PAYMENTS_VERSION = 1;

export async function getDashboardPayments(branches) {
  const cached = await getCachedAllPayments();
  if (cached.hit) return filterPayments(cached.value, branches);

  if (!canUseDirectFirebird()) {
    const stale = await getStaleAllPayments();
    if (stale.hit) return filterPayments(stale.value, branches);

    throw new AccessError(
      "Os pagamentos do Firebird ainda não foram sincronizados com o Redis.",
      503,
    );
  }

  const placeholders = branches.map(() => "?").join(",");
  const rows = await queryFirebird(createPaymentsSql(`AND F.IDFILIAL IN (${placeholders})`), branches);
  return rows.map(normalizePayment);
}

export async function syncAllDashboardPayments() {
  const rows = await queryFirebird(createPaymentsSql(""), [], {
    forceRefresh: true,
  });
  const payments = rows.map(normalizePayment);
  await setJsonCache(allPaymentsCacheKey(), payments, {
    ttlSeconds: cacheTtlSeconds(),
  });
  return payments.length;
}

function getCachedAllPayments() {
  return getJsonCacheEntry(allPaymentsCacheKey());
}

function getStaleAllPayments() {
  return getStaleJsonCache(allPaymentsCacheKey());
}

function allPaymentsCacheKey() {
  return createCacheKey("dashboard-payments-all", {
    version: DASHBOARD_PAYMENTS_VERSION,
  });
}

function filterPayments(payments, branches) {
  const selected = new Set(branches.map((branch) => normalizeValue(branch).toUpperCase()));
  return payments.filter((payment) => selected.has(normalizeValue(payment.filial).toUpperCase()));
}

function createPaymentsSql(branchFilter) {
  return `
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
      ${branchFilter}
    GROUP BY 1,2,3,4,5,6,7,8
    ORDER BY 7,8,1,6
  `;
}

function normalizePayment(row) {
  return {
    filial: normalizeValue(row.IDFILIAL).toUpperCase(),
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
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString("utf8").trim();
  }
  return String(value ?? "").trim();
}
