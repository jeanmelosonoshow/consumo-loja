const params = new URLSearchParams(window.location.search);
const branchId = String(
  params.get("a_system_user_unit_code") ??
    params.get("$a_system_user_unit_code") ??
    params.get("IDFILIAL_USR") ??
    "",
)
  .trim()
  .toUpperCase();
const employeeCode = String(
  params.get("a_system_user_custom_code") ??
    params.get("$a_system_user_custom_code") ??
    "",
)
  .trim()
  .toUpperCase();
let dashboardAccess = null;
let selectedBranches = [];
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
    const response = await fetchWithRetry(
      `/api/dashboard-acessos?filial=${encodeURIComponent(
        branchId,
      )}&funcionario=${encodeURIComponent(employeeCode)}`,
    );
    dashboardAccess = await response.json();
    if (!response.ok) throw new Error(dashboardAccess.message);

    selectedBranches = dashboardAccess.filiais.some(
      (branch) => branch.codigo === branchId,
    )
      ? [branchId]
      : [dashboardAccess.filiais[0].codigo];
    renderBranchFilter();
    await loadDashboard();
  } catch (error) {
    showError(error.message || "Não foi possível carregar o dashboard.");
  }
}

async function loadDashboard() {
  const query = new URLSearchParams({
    filial: branchId,
    funcionario: employeeCode,
    filiais: selectedBranches.join(","),
  });
  const [paymentResponse, readingResponse] = await Promise.all([
    fetchWithRetry(`/api/dashboard-pagamentos?${query}`),
    fetch(`/api/dashboard-leituras?${query}`),
  ]);
  const [paymentData, readingData] = await Promise.all([
    paymentResponse.json(),
    readingResponse.json(),
  ]);

  if (!paymentResponse.ok) throw new Error(paymentData.message);
  if (!readingResponse.ok) throw new Error(readingData.message);

  mergeSelectedBranchMetadata(paymentData.filiais ?? []);
  renderDashboard(
    paymentData,
    readingData.leituras ?? [],
    await loadSelectedBranchRates(),
  );
}

function mergeSelectedBranchMetadata(branches) {
  branches.forEach((branch) => {
    const index = dashboardAccess.filiais.findIndex(
      (allowed) => allowed.codigo === branch.codigo,
    );
    if (index >= 0) dashboardAccess.filiais[index] = branch;
  });
}

async function fetchWithRetry(url, attempts = 5) {
  let response;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    response = await fetch(url);
    if (response.status !== 503 || attempt === attempts) return response;
    await new Promise((resolve) => setTimeout(resolve, attempt * 900));
  }

  return response;
}

async function loadSelectedBranchRates() {
  const branches = dashboardAccess.filiais.filter((branch) =>
    selectedBranches.includes(branch.codigo),
  );
  const rateGroups = await Promise.all(
    branches.map(async (branch) => {
      if (!/^[A-Z]{2}$/.test(branch.uf)) return [];
      const query = new URLSearchParams({
        filial: branch.codigo,
        uf: branch.uf,
        cidade: branch.cidade,
      });
      const response = await fetch(`/api/dashboard-tarifas?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      return data.tarifas ?? [];
    }),
  );

  return ["ENERGIA", "AGUA"].map((resource) => {
    const available = rateGroups
      .flat()
      .filter(
        (rate) => rate.recurso === resource && Number(rate.valorUnitario) > 0,
      );
    if (!available.length) return { recurso: resource, origem: "INDISPONIVEL" };
    return {
      ...available[0],
      valorUnitario:
        available.reduce((sum, rate) => sum + Number(rate.valorUnitario), 0) /
        available.length,
      origem: available.length > 1 ? "MEDIA_FILIAIS" : available[0].origem,
    };
  });
}

function renderBranchFilter() {
  const filter = document.querySelector("#branch-filter");
  const options = document.querySelector("#branch-options");
  const trigger = document.querySelector("#branch-select-trigger");
  const menu = document.querySelector("#branch-select-menu");
  filter.hidden = !dashboardAccess.multiplaSelecao;
  document.querySelector("#access-description").textContent =
    dashboardAccess.multiplaSelecao
      ? `Categoria ${dashboardAccess.categoria}: selecione uma ou mais filiais`
      : "Acesso restrito à filial identificada";

  options.replaceChildren(
    ...dashboardAccess.filiais.map((branch) => {
      const label = document.createElement("label");
      label.className = "branch-option";
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(branch.codigo)}"
          ${selectedBranches.includes(branch.codigo) ? "checked" : ""}>
        <span>${escapeHtml(branch.codigo)} · ${escapeHtml(branch.nome)}</span>
      `;
      return label;
    }),
  );

  updateBranchSelectionSummary();
  trigger.addEventListener("click", () => {
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", String(willOpen));
  });

  document.querySelector("#select-all-branches").addEventListener("click", () => {
    options.querySelectorAll("input").forEach((input) => {
      input.checked = true;
    });
    updateBranchSelectionSummary(true);
  });

  document.querySelector("#clear-branches").addEventListener("click", () => {
    options.querySelectorAll("input").forEach((input) => {
      input.checked = false;
    });
    updateBranchSelectionSummary(true);
  });

  options.addEventListener("change", () => updateBranchSelectionSummary(true));
  document.addEventListener("click", (event) => {
    if (!document.querySelector("#branch-select").contains(event.target)) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  document.querySelector("#apply-branches").addEventListener("click", async () => {
    const checked = Array.from(
      document.querySelectorAll("#branch-options input:checked"),
    ).map((input) => input.value);
    if (!checked.length) {
      showError("Selecione pelo menos uma filial para atualizar o dashboard.");
      return;
    }
    selectedBranches = checked;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    updateBranchSelectionSummary();
    document.querySelector("#dashboard-error").hidden = true;
    try {
      await loadDashboard();
    } catch (error) {
      showError(error.message || "Não foi possível atualizar o dashboard.");
    }
  });
}

function updateBranchSelectionSummary(usePendingSelection = false) {
  const checked = usePendingSelection
    ? Array.from(document.querySelectorAll("#branch-options input:checked")).map(
        (input) => input.value,
      )
    : selectedBranches;
  const summary = document.querySelector("#branch-select-summary");

  if (!checked.length) {
    summary.textContent = "Nenhuma filial selecionada";
    return;
  }

  if (checked.length === dashboardAccess.filiais.length) {
    summary.textContent = `Todas as filiais (${checked.length})`;
    return;
  }

  const first = dashboardAccess.filiais.find(
    (branch) => branch.codigo === checked[0],
  );
  summary.textContent =
    checked.length === 1
      ? `${first.codigo} · ${first.nome}`
      : `${first.codigo} · ${first.nome} + ${checked.length - 1} filial(is)`;
}

function renderDashboard(paymentData, readings, rates) {
  const branch = paymentData.filial ?? {};
  document.querySelector("#branch-description").textContent =
    selectedBranches.length > 1
      ? `${selectedBranches.length} filiais selecionadas`
      : branch.nome
        ? `${branch.nome} · ${branch.cidade || ""}/${branch.uf || ""}`
        : `Filial ${selectedBranches[0]}`;
  document.querySelector("#branch-code").textContent =
    selectedBranches.length > 1
      ? `${selectedBranches.length} filiais`
      : selectedBranches[0];

  const monthlyConsumption = aggregateMonthlyConsumption(readings);
  const monthlyPayments = aggregateMonthlyPayments(paymentData.pagamentos ?? []);
  const calibratedRates = calibrateRatesByCompetence(
    monthlyConsumption,
    monthlyPayments,
    rates,
  );
  const estimatedConsumption = estimatePaidConsumption(
    monthlyPayments,
    calibratedRates,
  );
  const displayedConsumption = mergeConsumption(
    monthlyConsumption,
    estimatedConsumption,
  );
  const current = currentMonthKey();
  const energyCurrent = displayedConsumption.get(current)?.ENERGIA ?? 0;
  const waterCurrent = displayedConsumption.get(current)?.AGUA ?? 0;
  const projections = calculateProjections(
    readings,
    monthlyPayments,
    calibratedRates,
  );
  const increases = readings
    .filter((reading) => {
      const limit = reading.TIPO_CONTADOR === "ENERGIA" ? 8 : 5;
      return Number(reading.VARIACAO_PERCENTUAL) > limit;
    })
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
  renderBranchAverageChart(paymentData.pagamentos ?? []);
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

function aggregateAveragePaymentsByBranch(payments) {
  const result = new Map();

  payments.forEach((payment) => {
    if (!["ENERGIA", "AGUA"].includes(payment.recurso)) return;
    const branch = String(payment.filial);
    const values = result.get(branch) ?? {
      nome: payment.nomeFilial || `Filial ${branch}`,
      ENERGIA: { total: 0, months: new Set() },
      AGUA: { total: 0, months: new Set() },
    };
    const resource = values[payment.recurso];
    resource.total += Number(payment.pagamento);
    resource.months.add(`${payment.ano}-${String(payment.mes).padStart(2, "0")}`);
    result.set(branch, values);
  });

  return Array.from(result.entries())
    .map(([branch, values]) => ({
      branch,
      name: values.nome,
      ENERGIA: values.ENERGIA.months.size
        ? values.ENERGIA.total / values.ENERGIA.months.size
        : 0,
      AGUA: values.AGUA.months.size
        ? values.AGUA.total / values.AGUA.months.size
        : 0,
      energyMonths: values.ENERGIA.months.size,
      waterMonths: values.AGUA.months.size,
    }))
    .sort((a, b) => a.branch.localeCompare(b.branch));
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

function calibrateRatesByCompetence(consumption, payments, rates) {
  const currentKey = currentMonthKey();

  return ["ENERGIA", "AGUA"].map((resource) => {
    const referenceRate = findRate(rates, resource);
    const competenceRates = Array.from(payments.entries())
      .filter(([month, values]) => {
        const measured = consumption.get(month)?.[resource] ?? 0;
        return month !== currentKey && values[resource] > 0 && measured > 0;
      })
      .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
      .slice(-6)
      .map(([month, values]) => ({
        month,
        value: values[resource] / consumption.get(month)[resource],
      }))
      .filter((item) => Number.isFinite(item.value) && item.value > 0);

    if (!competenceRates.length) {
      return referenceRate ?? { recurso: resource, origem: "INDISPONIVEL" };
    }

    return {
      recurso: resource,
      valorBase: referenceRate?.valorBase ?? referenceRate?.valorUnitario,
      fatorAjuste: 1,
      valorUnitario: median(competenceRates.map((item) => item.value)),
      unidade: referenceRate?.unidade ?? `R$/${resource === "ENERGIA" ? "kWh" : "m³"}`,
      origem: "HISTORICO_COMPETENCIA",
      competencias: competenceRates.map((item) => item.month),
    };
  });
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
  const estimatedConsumption = estimatePaidConsumption(payments, rates);
  const comparableConsumption = mergeConsumption(
    monthlyConsumption,
    estimatedConsumption,
  );

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
    const referenceMonths = Array.from(comparableConsumption.entries())
      .filter(
        ([month, values]) =>
          month !== currentKey && Number(values[resource] ?? 0) > 0,
      )
      .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
      .slice(-3);
    const referenceConsumption = referenceMonths.length
      ? referenceMonths.reduce(
          (sum, [, values]) => sum + Number(values[resource]),
          0,
        ) / referenceMonths.length
      : null;
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
      referenceConsumption,
      referenceMonthCount: referenceMonths.length,
    };
  });

  return result;
}

function findRate(rates, resource) {
  return rates.find(
    (rate) => rate.recurso === resource && Number(rate.valorUnitario) > 0,
  );
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
  const formatted = currency ? formatCurrency(value) : formatConsumption(value);
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
      const consumptionComparison =
        data?.referenceConsumption != null
          ? createConsumptionComparison(
              data.consumption,
              data.referenceConsumption,
              unit,
            )
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
                  describeRateOrigin(data.rate)
                }</span>`
              : ""
          }
          ${
            consumptionComparison
              ? `
                <div class="projection-comparison projection-comparison--${consumptionComparison.direction}">
                  <span>Referência de consumo (${data.referenceMonthCount} mês(es) recente(s))</span>
                  <strong>${formatUnit(data.referenceConsumption, unit)}</strong>
                  <span class="variation-badge">${consumptionComparison.badge}</span>
                  <span>${consumptionComparison.message}</span>
                </div>
              `
              : ""
          }
          ${
            comparison
              ? `
                <div class="projection-comparison projection-comparison--${comparison.direction}">
                  <span>Último mês pago (${formatMonth(data.lastPaidMonth.month)})</span>
                  <strong>${formatCurrency(data.lastPaidMonth.paid)}</strong>
                  <span class="variation-badge">${comparison.badge}</span>
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

function createConsumptionComparison(projectedConsumption, reference, unit) {
  const difference = projectedConsumption - reference;
  const percentage =
    reference > 0 ? (Math.abs(difference) / reference) * 100 : 0;
  const direction = difference > 0 ? "higher" : difference < 0 ? "lower" : "equal";

  return {
    direction,
    badge: createVariationBadge(direction, percentage),
    message:
      direction === "equal"
        ? "Consumo projetado estável em relação à referência"
        : `Diferença de ${formatUnit(Math.abs(difference), unit)} entre os indicadores`,
  };
}

function createCostComparison(projectedCost, lastPaidMonth) {
  const difference = projectedCost - lastPaidMonth.paid;
  const percentage =
    lastPaidMonth.paid > 0 ? (Math.abs(difference) / lastPaidMonth.paid) * 100 : 0;
  const direction = difference > 0 ? "higher" : difference < 0 ? "lower" : "equal";
  return {
    direction,
    badge: createVariationBadge(direction, percentage),
    message:
      direction === "equal"
        ? "Projeção igual ao último mês pago"
        : `Diferença de ${formatCurrency(Math.abs(difference))} entre os indicadores`,
  };
}

function createVariationBadge(direction, percentage) {
  if (direction === "equal") return "0% · Estável";
  return `${direction === "higher" ? "+" : "-"}${formatNumber(
    percentage,
  )}% · ${direction === "higher" ? "Aumento" : "Redução"}`;
}

function describeRateOrigin(rate) {
  if (rate.origem === "HISTORICO_COMPETENCIA") {
    return `Histórico real de ${rate.competencias.length} competência(s)`;
  }
  if (rate.origem === "BANCO") return "Cadastro interno";
  if (rate.origem === "MEDIA_FILIAIS") return "Média das filiais selecionadas";
  return rate.fatorAjuste > 1
    ? `Fallback calibrado (fator ${formatNumber(rate.fatorAjuste)})`
    : "Fallback genérico externo";
}

function renderIncreaseTable(increases) {
  const body = document.querySelector("#increase-table");

  if (!increases.length) {
    body.innerHTML =
      '<tr><td class="empty-row" colspan="9">Nenhum aumento comparável encontrado.</td></tr>';
    return;
  }

  body.replaceChildren(
    ...increases.slice(0, 100).map((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${formatDate(item.DATA_LEITURA)}</td>
        <td>${escapeHtml(item.IDFILIAL_USR)}</td>
        <td>${item.TIPO_CONTADOR === "ENERGIA" ? "Energia" : "Água"}</td>
        <td>${escapeHtml(item.APELIDO_CONTADOR)}</td>
        <td>${formatConsumption(item.CONSUMO)}</td>
        <td class="increase-badge">+${formatNumber(item.VARIACAO_PERCENTUAL)}%</td>
        <td>${escapeHtml(REASON_CATEGORIES[item.MOTIVO] ?? "Não informada")}</td>
        <td>${escapeHtml(REASON_LABELS[item.MOTIVO] ?? item.MOTIVO ?? "Não informado")}</td>
        <td>${escapeHtml(item.OBSERVACAO ?? "Não informada")}</td>
      `;
      return row;
    }),
  );
}

function renderBranchAverageChart(payments) {
  const container = document.querySelector("#branch-average-chart");
  const branches = aggregateAveragePaymentsByBranch(payments);

  if (!branches.length) {
    container.innerHTML =
      '<div class="empty-row">Nenhum pagamento encontrado para calcular as médias.</div>';
    return;
  }

  const max = Math.max(
    1,
    ...branches.flatMap((branch) => [branch.ENERGIA, branch.AGUA]),
  );

  container.replaceChildren(
    ...branches.map((branch) => {
      const row = document.createElement("article");
      row.className = "branch-average-row";
      row.innerHTML = `
        <div class="branch-average-label">
          <strong>${escapeHtml(branch.branch)} · ${escapeHtml(branch.name)}</strong>
          <span>Média das competências pagas</span>
        </div>
        <div class="branch-average-bars">
          ${createBranchAverageBar(
            branch.ENERGIA,
            max,
            false,
            branch.energyMonths,
          )}
          ${createBranchAverageBar(branch.AGUA, max, true, branch.waterMonths)}
        </div>
      `;
      return row;
    }),
  );
}

function createBranchAverageBar(value, max, water, monthCount) {
  const width = value > 0 ? Math.max(1, (value / max) * 100) : 0;
  return `
    <div class="branch-average-bar">
      <div class="branch-average-track" title="${
        water ? "Água" : "Energia"
      }: ${formatCurrency(value)} em ${monthCount} competência(s)">
        <div class="branch-average-fill ${
          water ? "branch-average-fill--water" : ""
        }" style="width:${width}%"></div>
      </div>
      <span class="branch-average-value">${formatCurrency(value)}</span>
    </div>
  `;
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
  return `${formatConsumption(value)} ${unit}`;
}

function formatConsumption(value) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0,
  }).format(Math.round(Number(value) || 0));
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
