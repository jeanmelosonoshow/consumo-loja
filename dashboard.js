const params = new URLSearchParams(window.location.search);
const branchId = String(
  params.get("a_system_user_unit_code") ??
    params.get("$a_system_user_unit_code") ??
    params.get("IDFILIAL_USR") ??
    "",
)
  .trim()
  .toUpperCase();
const REASON_LABELS = {
  USO_EXCEDENTE: "Uso excedente",
  ESQUECIMENTO: "Esquecimento",
  DESVIO_PROCEDIMENTO: "Desvio de procedimento",
  FALHA_MEDICAO: "Falha na medição",
  AUMENTO_ATIPICO_DEMANDA: "Aumento atípico de demanda",
  CONDICOES_CLIMATICAS: "Condições climáticas",
  VAZAMENTO_FALHA_HIDRAULICA: "Vazamentos ou falhas hidráulicas",
  FALHA_ELETRICA: "Falhas elétricas",
  MANUTENCAO_REPARO: "Manutenção / reparo",
};
const REASON_CATEGORIES = {
  USO_EXCEDENTE: "Falhas humanas / operacionais",
  ESQUECIMENTO: "Falhas humanas / operacionais",
  DESVIO_PROCEDIMENTO: "Falhas humanas / operacionais",
  FALHA_MEDICAO: "Falhas humanas / operacionais",
  AUMENTO_ATIPICO_DEMANDA: "Eventos externos ou sazonais",
  CONDICOES_CLIMATICAS: "Eventos externos ou sazonais",
  VAZAMENTO_FALHA_HIDRAULICA: "Problemas técnicos / estruturais",
  FALHA_ELETRICA: "Problemas técnicos / estruturais",
  MANUTENCAO_REPARO: "Problemas técnicos / estruturais",
};

initializeDashboard();

async function initializeDashboard() {
  document.querySelector("#branch-code").textContent = branchId || "--";

  if (!/^[A-Z0-9]{2}$/.test(branchId)) {
    showError("A filial não foi identificada. Abra o dashboard pelo Adianti.");
    return;
  }

  try {
    const [paymentResponse, readingResponse] = await Promise.all([
      fetch(`/api/dashboard-pagamentos?filial=${encodeURIComponent(branchId)}`),
      fetch(`/api/dashboard-leituras?filial=${encodeURIComponent(branchId)}`),
    ]);
    const [paymentData, readingData] = await Promise.all([
      paymentResponse.json(),
      readingResponse.json(),
    ]);

    if (!paymentResponse.ok) throw new Error(paymentData.message);
    if (!readingResponse.ok) throw new Error(readingData.message);

    const branch = paymentData.filial ?? {};
    const rateResponse = await fetch(
      `/api/dashboard-tarifas?filial=${encodeURIComponent(
        branchId,
      )}&uf=${encodeURIComponent(branch.uf ?? "")}&cidade=${encodeURIComponent(
        branch.cidade ?? "",
      )}`,
    );
    const rateData = await rateResponse.json();

    if (!rateResponse.ok) throw new Error(rateData.message);

    renderDashboard(
      paymentData,
      readingData.leituras ?? [],
      rateData.tarifas ?? [],
    );
    initializeHeightReporting();
  } catch (error) {
    showError(error.message || "Não foi possível carregar o dashboard.");
    initializeHeightReporting();
  }
}

function renderDashboard(paymentData, readings, rates) {
  const branch = paymentData.filial ?? {};
  document.querySelector("#branch-description").textContent = branch.nome
    ? `${branch.nome} · ${branch.cidade || ""}/${branch.uf || ""}`
    : `Filial ${branchId}`;

  const monthlyConsumption = aggregateMonthlyConsumption(readings);
  const monthlyPayments = aggregateMonthlyPayments(paymentData.pagamentos ?? []);
  const estimatedConsumption = estimatePaidConsumption(monthlyPayments, rates);
  const displayedConsumption = mergeConsumption(
    monthlyConsumption,
    estimatedConsumption,
  );
  const current = currentMonthKey();
  const energyCurrent = displayedConsumption.get(current)?.ENERGIA ?? 0;
  const waterCurrent = displayedConsumption.get(current)?.AGUA ?? 0;
  const projections = calculateProjections(readings, monthlyPayments, rates);
  const increases = readings
    .filter((reading) => Number(reading.VARIACAO_PERCENTUAL) > 0)
    .sort(
      (a, b) =>
        Number(b.VARIACAO_PERCENTUAL) - Number(a.VARIACAO_PERCENTUAL),
    );

  setText("#energy-month", formatUnit(energyCurrent, "kWh"));
  setText("#water-month", formatUnit(waterCurrent, "m³"));
  setText(
    "#paid-total",
    formatCurrency(
      (paymentData.pagamentos ?? []).reduce(
        (total, item) => total + Number(item.pagamento),
        0,
      ),
    ),
  );
  setText("#increase-days", String(increases.length));
  setText(
    "#energy-projection",
    projections.ENERGIA
      ? `Projeção: ${formatUnit(projections.ENERGIA.consumption, "kWh")}`
      : "Dados insuficientes para projeção",
  );
  setText(
    "#water-projection",
    projections.AGUA
      ? `Projeção: ${formatUnit(projections.AGUA.consumption, "m³")}`
      : "Dados insuficientes para projeção",
  );

  renderChart("#consumption-chart", displayedConsumption, false);
  renderChart("#payment-chart", monthlyPayments, true);
  renderProjections(projections);
  renderIncreaseTable(increases);
}

function aggregateMonthlyConsumption(readings) {
  const result = new Map();

  readings.forEach((reading) => {
    if (reading.CONSUMO == null) return;
    const key = String(reading.DATA_LEITURA).slice(0, 7);
    const resource = reading.TIPO_CONTADOR;
    const values = result.get(key) ?? { ENERGIA: 0, AGUA: 0 };
    values[resource] = (values[resource] ?? 0) + Number(reading.CONSUMO);
    result.set(key, values);
  });

  return result;
}

function aggregateMonthlyPayments(payments) {
  const result = new Map();

  payments.forEach((payment) => {
    const key = `${payment.ano}-${String(payment.mes).padStart(2, "0")}`;
    const resource = payment.recurso;
    if (!["ENERGIA", "AGUA"].includes(resource)) return;
    const values = result.get(key) ?? { ENERGIA: 0, AGUA: 0 };
    values[resource] = (values[resource] ?? 0) + Number(payment.pagamento);
    result.set(key, values);
  });

  return result;
}

function estimatePaidConsumption(payments, rates) {
  const result = new Map();

  payments.forEach((values, month) => {
    const estimated = { ENERGIA: 0, AGUA: 0 };
    ["ENERGIA", "AGUA"].forEach((resource) => {
      const rate = findRate(rates, resource);
      const paid = values[resource] ?? 0;
      if (rate?.valorUnitario > 0 && paid > 0) {
        estimated[resource] = paid / rate.valorUnitario;
      }
    });
    result.set(month, estimated);
  });

  return result;
}

function mergeConsumption(measured, estimated) {
  const result = new Map(estimated);

  measured.forEach((values, month) => {
    const existing = result.get(month) ?? { ENERGIA: 0, AGUA: 0 };
    result.set(month, {
      ENERGIA: values.ENERGIA > 0 ? values.ENERGIA : existing.ENERGIA,
      AGUA: values.AGUA > 0 ? values.AGUA : existing.AGUA,
    });
  });

  return result;
}

function calculateProjections(readings, payments, rates) {
  const result = {};
  const now = new Date();
  const elapsedDays = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const currentKey = currentMonthKey();
  const monthlyConsumption = aggregateMonthlyConsumption(readings);

  ["ENERGIA", "AGUA"].forEach((resource) => {
    const currentConsumption = monthlyConsumption.get(currentKey)?.[resource] ?? 0;
    const paidMonths = [];

    payments.forEach((values, month) => {
      const paid = values[resource] ?? 0;
      if (paid > 0) paidMonths.push({ month, paid });
    });
    paidMonths.sort((a, b) => a.month.localeCompare(b.month));
    const lastPaidMonth = paidMonths.at(-1) ?? null;
    const rate = findRate(rates, resource);
    let projectedConsumption =
      currentConsumption > 0 && elapsedDays > 0
        ? (currentConsumption / elapsedDays) * daysInMonth
        : null;

    if (projectedConsumption == null && rate?.valorUnitario > 0) {
      const recentPaid = paidMonths.slice(-3);
      projectedConsumption = recentPaid.length
        ? recentPaid.reduce(
            (sum, item) => sum + item.paid / rate.valorUnitario,
            0,
          ) / recentPaid.length
        : null;
    }

    if (projectedConsumption == null) return;

    result[resource] = {
      consumption: projectedConsumption,
      rate,
      cost:
        rate?.valorUnitario > 0
          ? projectedConsumption * rate.valorUnitario
          : null,
      lastPaidMonth,
    };
  });

  return result;
}

function findRate(rates, resource) {
  return rates.find(
    (rate) => rate.recurso === resource && Number(rate.valorUnitario) > 0,
  );
}

function renderChart(selector, data, currency) {
  const container = document.querySelector(selector);
  const months = lastSixMonthKeys();
  const max = Math.max(
    1,
    ...months.flatMap((month) => [
      data.get(month)?.ENERGIA ?? 0,
      data.get(month)?.AGUA ?? 0,
    ]),
  );

  container.replaceChildren(
    ...months.map((month) => {
      const values = data.get(month) ?? { ENERGIA: 0, AGUA: 0 };
      const group = document.createElement("div");
      group.className = "chart-group";
      group.innerHTML = `
        <div class="chart-bars">
          ${createBar(values.ENERGIA, max, false, currency)}
          ${createBar(values.AGUA, max, true, currency)}
        </div>
        <strong>${formatMonth(month)}</strong>
        <span>${currency ? formatCurrency(values.ENERGIA + values.AGUA) : ""}</span>
      `;
      return group;
    }),
  );
}

function createBar(value, max, water, currency) {
  const height = Math.max(2, (Number(value) / max) * 100);
  const formatted = currency ? formatCurrency(value) : formatNumber(value);
  return `<div class="chart-bar ${water ? "chart-bar--water" : ""}"
    style="height:${height}%"
    title="${water ? "Água" : "Energia"}: ${formatted}"></div>`;
}

function renderProjections(projections) {
  const container = document.querySelector("#projection-content");
  const definitions = [
    ["ENERGIA", "Energia", "kWh"],
    ["AGUA", "Água", "m³"],
  ];

  container.replaceChildren(
    ...definitions.map(([key, label, unit]) => {
      const data = projections[key];
      const card = document.createElement("article");
      card.className = "projection-card";
      const comparison =
        data?.cost != null && data?.lastPaidMonth
          ? createCostComparison(data.cost, data.lastPaidMonth)
          : null;
      card.innerHTML = data
        ? `
          <span>${label} projetada</span>
          <strong>${formatUnit(data.consumption, unit)}</strong>
          <span>${
            data.cost == null
              ? "Custo: histórico insuficiente"
              : `Custo estimado: ${formatCurrency(data.cost)}`
          }</span>
          ${
            data.rate
              ? `<span class="projection-source">Tarifa: ${formatCurrency(
                  data.rate.valorUnitario,
                )}/${data.rate.unidade.split("/").at(-1)} · ${
                  data.rate.origem === "BANCO"
                    ? "Cadastro interno"
                    : "Fallback genérico externo"
                }</span>`
              : ""
          }
          ${
            comparison
              ? `
                <div class="projection-comparison projection-comparison--${comparison.direction}">
                  <span>Último mês pago (${formatMonth(data.lastPaidMonth.month)})</span>
                  <strong>${formatCurrency(data.lastPaidMonth.paid)}</strong>
                  <span>${comparison.message}</span>
                </div>
              `
              : ""
          }
        `
        : `
          <span>${label} projetada</span>
          <strong>Dados insuficientes</strong>
        `;
      return card;
    }),
  );
}

function createCostComparison(projectedCost, lastPaidMonth) {
  const difference = projectedCost - lastPaidMonth.paid;
  const percentage =
    lastPaidMonth.paid > 0 ? (Math.abs(difference) / lastPaidMonth.paid) * 100 : 0;
  const direction = difference > 0 ? "higher" : difference < 0 ? "lower" : "equal";
  const description =
    direction === "higher"
      ? "acima"
      : direction === "lower"
        ? "abaixo"
        : "igual ao";

  return {
    direction,
    message:
      direction === "equal"
        ? "Projeção igual ao último mês pago"
        : `${formatCurrency(Math.abs(difference))} (${formatNumber(
            percentage,
          )}%) ${description} do último mês pago`,
  };
}

function renderIncreaseTable(increases) {
  const body = document.querySelector("#increase-table");

  if (!increases.length) {
    body.innerHTML =
      '<tr><td class="empty-row" colspan="8">Nenhum aumento comparável encontrado.</td></tr>';
    return;
  }

  body.replaceChildren(
    ...increases.slice(0, 100).map((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${formatDate(item.DATA_LEITURA)}</td>
        <td>${item.TIPO_CONTADOR === "ENERGIA" ? "Energia" : "Água"}</td>
        <td>${escapeHtml(item.APELIDO_CONTADOR)}</td>
        <td>${formatNumber(item.CONSUMO)}</td>
        <td class="increase-badge">+${formatNumber(item.VARIACAO_PERCENTUAL)}%</td>
        <td>${escapeHtml(REASON_CATEGORIES[item.MOTIVO] ?? "Não informada")}</td>
        <td>${escapeHtml(REASON_LABELS[item.MOTIVO] ?? item.MOTIVO ?? "Não informado")}</td>
        <td>${escapeHtml(item.OBSERVACAO ?? "Não informada")}</td>
      `;
      return row;
    }),
  );
}

function lastSixMonthKeys() {
  const result = [];
  const date = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    result.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    );
    date.setMonth(date.getMonth() - 1);
  }
  return result.reverse();
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(key) {
  const [year, month] = key.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "short" })
    .format(new Date(Number(year), Number(month) - 1, 1))
    .replace(".", "");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(value),
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatUnit(value, unit) {
  return `${formatNumber(value)} ${unit}`;
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function showError(message) {
  const error = document.querySelector("#dashboard-error");
  error.textContent = message;
  error.hidden = false;
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function initializeHeightReporting() {
  const reportHeight = () => {
    window.parent.postMessage(
      {
        type: "consumo-loja:dashboard-height",
        height: document.documentElement.scrollHeight,
      },
      "*",
    );
  };

  const observer = new ResizeObserver(reportHeight);
  observer.observe(document.documentElement);
  window.addEventListener("load", reportHeight);
  reportHeight();
}
