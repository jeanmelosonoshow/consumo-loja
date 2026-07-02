const params = new URLSearchParams(window.location.search);
let branchId = normalizeBranchCode(
  params.get("$a_system_user_unit_code") ??
  params.get("a_system_user_unit_code") ??
  params.get("IDFILIAL_USR") ??
  params.get("idfilial_usr") ??
  "",
);
let branchLabel =
  params.get("NOME_FILIAL") ?? params.get("nome_filial") ?? branchId;

const LOGIN_STORAGE_KEY = "consumo-loja:usuario";
const loginScreen = document.querySelector("#login-screen");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const logoutButton = document.querySelector("#logout-button");
const dialog = document.querySelector("#meter-dialog");
const meterForm = document.querySelector("#meter-form");
const dialogTitle = document.querySelector("#dialog-title");
const formError = document.querySelector("#form-error");
const readingsForm = document.querySelector("#readings-form");
const readingsActions = document.querySelector("#readings-actions");
const messageDialog = document.querySelector("#message-dialog");
const messageDialogIcon = document.querySelector("#message-dialog-icon");
const messageDialogEyebrow = document.querySelector("#message-dialog-eyebrow");
const messageDialogTitle = document.querySelector("#message-dialog-title");
const messageDialogText = document.querySelector("#message-dialog-text");
let selectedMeterType = null;
let meters = [];
const REASONS_BY_CATEGORY = [
  {
    label: "Falhas humanas / operacionais",
    reasons: [
      ["USO_EXCEDENTE", "Uso excedente"],
      ["ESQUECIMENTO", "Esquecimento"],
      ["DESVIO_PROCEDIMENTO", "Desvio de procedimento"],
      ["FALHA_MEDICAO", "Falha na medição"],
    ],
  },
  {
    label: "Eventos externos ou sazonais",
    reasons: [
      ["AUMENTO_ATIPICO_DEMANDA", "Aumento atípico de demanda"],
      ["CONDICOES_CLIMATICAS", "Condições climáticas"],
    ],
  },
  {
    label: "Problemas técnicos / estruturais",
    reasons: [
      ["VAZAMENTO_FALHA_HIDRAULICA", "Vazamentos ou falhas hidráulicas"],
      ["FALHA_ELETRICA", "Falhas elétricas"],
      ["MANUTENCAO_REPARO", "Manutenção / reparo"],
    ],
  },
];

initialize();

function initialize() {
  document.querySelector("#reference-date").textContent =
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
    }).format(new Date());

  document.querySelectorAll("[data-open-meter]").forEach((button) => {
    button.addEventListener("click", () => openMeterDialog(button.dataset.openMeter));
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  document
    .querySelector("#message-dialog-close")
    .addEventListener("click", () => messageDialog.close());

  meterForm.addEventListener("submit", saveMeter);
  readingsForm.addEventListener("submit", saveReadings);
  loginForm.addEventListener("submit", authenticateUser);
  logoutButton.addEventListener("click", logout);
  dialog.addEventListener("close", resetForm);
  initializeAccess();
}

function initializeAccess() {
  if (branchId) {
    activateApp({ authenticatedByLogin: false });
    return;
  }

  const savedUser = getSavedUser();

  if (savedUser?.idfilial) {
    branchId = normalizeBranchCode(savedUser.idfilial);
    branchLabel = branchId;
    activateApp({ authenticatedByLogin: true });
    return;
  }

  showLogin();
}

function showLogin() {
  loginScreen.hidden = false;
  document.querySelectorAll(".app-content").forEach((element) => {
    element.hidden = true;
  });
  document.querySelector("#login-user").focus();
}

function activateApp({ authenticatedByLogin }) {
  loginScreen.hidden = true;
  document.querySelectorAll(".app-content").forEach((element) => {
    element.hidden = false;
  });
  document.querySelector("#branch-name").textContent = branchLabel;
  document.querySelector("#missing-branch").hidden = true;
  document.querySelectorAll("[data-open-meter]").forEach((button) => {
    button.disabled = false;
  });
  logoutButton.hidden = !authenticatedByLogin;
  loadMeters();
}

async function authenticateUser(event) {
  event.preventDefault();
  loginError.hidden = true;

  const formData = new FormData(loginForm);
  const submitButton = loginForm.querySelector('[type="submit"]');

  try {
    setLoginButtonLoading(submitButton, true);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: formData.get("usuario"),
        senha: formData.get("senha"),
      }),
    });
    const result = await response.json();

    if (!response.ok || !result.autorizado || !result.idfilial) {
      throw new Error(result.message || "Usuário ou senha inválidos.");
    }

    sessionStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(result));
    branchId = normalizeBranchCode(result.idfilial);
    branchLabel = branchId;
    loginForm.reset();
    activateApp({ authenticatedByLogin: true });
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally {
    setLoginButtonLoading(submitButton, false);
  }
}

function getSavedUser() {
  try {
    return JSON.parse(sessionStorage.getItem(LOGIN_STORAGE_KEY));
  } catch {
    sessionStorage.removeItem(LOGIN_STORAGE_KEY);
    return null;
  }
}

function logout() {
  sessionStorage.removeItem(LOGIN_STORAGE_KEY);
  branchId = "";
  branchLabel = "";
  meters = [];
  readingsForm.reset();
  logoutButton.hidden = true;
  showLogin();
}

function openMeterDialog(type) {
  selectedMeterType = type;
  dialogTitle.textContent = `Cadastrar relógio de ${
    type === "ENERGIA" ? "energia" : "água"
  }`;
  dialog.showModal();
  document.querySelector("#meter-nickname").focus();
}

async function saveMeter(event) {
  event.preventDefault();

  const formData = new FormData(meterForm);
  const nickname = formData.get("nickname").trim();
  const number = formData.get("number").trim();
  const submitButton = meterForm.querySelector('[type="submit"]');
  const payload = {
    IDFILIAL_USR: branchId,
    APELIDO_CONTADOR: nickname,
    NUMERO_CONTADOR: number,
    TIPO_CONTADOR: selectedMeterType,
  };

  try {
    setButtonLoading(submitButton, true);
    const response = await fetch("/api/contadores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Não foi possível cadastrar o relógio.");
    }

    meters.push(result);
    dialog.close();
    renderMeters();
    showMessage({
      type: "success",
      title: "Relógio cadastrado",
      message: `${nickname} foi cadastrado com sucesso e já está disponível para receber leituras.`,
    });
  } catch (error) {
    showMessage({
      type: "error",
      title: "Não foi possível cadastrar",
      message: error.message,
    });
  } finally {
    setButtonLoading(submitButton, false);
  }
}

function getBranchMeters(type) {
  return meters.filter((meter) => meter.TIPO_CONTADOR === type);
}

async function loadMeters() {
  if (!branchId) {
    renderMeters();
    return;
  }

  renderLoading();

  try {
    const response = await fetch(
      `/api/contadores?filial=${encodeURIComponent(branchId)}`,
    );
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Não foi possível carregar os relógios.");
    }

    meters = result;
    renderMeters();
  } catch (error) {
    renderLoadError(error.message);
  }
}

function renderMeters() {
  renderMeterList("ENERGIA", document.querySelector("#energy-meters"));
  renderMeterList("AGUA", document.querySelector("#water-meters"));
  readingsActions.hidden = meters.length === 0;
}

function renderMeterList(type, container) {
  const meters = getBranchMeters(type);

  if (!meters.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Nenhum relógio cadastrado</strong>
        <span>Cadastre o primeiro relógio de ${
          type === "ENERGIA" ? "energia" : "água"
        } desta filial.</span>
      </div>
    `;
    return;
  }

  container.replaceChildren(
    ...meters.map((meter) => {
      const item = document.createElement("fieldset");
      item.className = "meter-reading";
      item.dataset.meterId = meter.ID_CONTADOR;

      const header = document.createElement("div");
      header.className = "meter-reading__header";

      const identity = document.createElement("div");
      identity.className = "meter-reading__identity";

      const text = document.createElement("div");
      text.className = "meter-reading__text";

      const name = document.createElement("strong");
      name.textContent = meter.APELIDO_CONTADOR;

      const number = document.createElement("span");
      number.textContent = `Nº ${meter.NUMERO_CONTADOR}`;

      const lastReading = document.createElement("div");
      lastReading.className = "last-reading";
      const lastReadingText =
        meter.ULTIMA_LEITURA == null
          ? "Nenhuma leitura registrada"
          : `${formatReading(meter.ULTIMA_LEITURA)} em ${formatDate(
              meter.DATA_ULTIMA_LEITURA,
            )}`;
      lastReading.innerHTML = `
        <span>Última leitura</span>
        <strong>${lastReadingText}</strong>
      `;

      text.append(name, number);
      identity.append(text);
      header.append(identity, lastReading);
      item.append(header, createReadingFields(meter, type));
      return item;
    }),
  );
}

function createReadingFields(meter, type) {
  const unit = type === "ENERGIA" ? "kWh" : "m³";
  const increaseLimit = type === "ENERGIA" ? 8 : 5;
  const fields = document.createElement("div");
  fields.className = "reading-fields";
  fields.innerHTML = `
    <div class="reading-field">
      <label for="date-${meter.ID_CONTADOR}">Data da leitura *</label>
      <input
        id="date-${meter.ID_CONTADOR}"
        name="date-${meter.ID_CONTADOR}"
        type="date"
        required
      />
    </div>
    <div class="reading-field">
      <label for="value-${meter.ID_CONTADOR}">Valor da leitura (${unit}) *</label>
      <input
        id="value-${meter.ID_CONTADOR}"
        name="value-${meter.ID_CONTADOR}"
        type="number"
        min="0"
        step="1"
        inputmode="numeric"
        placeholder="0"
        required
      />
    </div>
    <div class="reading-field reading-field--wide">
      <label for="reason-${meter.ID_CONTADOR}">Motivo</label>
      <select
        id="reason-${meter.ID_CONTADOR}"
        name="reason-${meter.ID_CONTADOR}"
      >
        <option value="">Selecione um motivo</option>
        ${createReasonOptions()}
      </select>
    </div>
    <div class="reading-field reading-field--wide">
      <label for="observation-${meter.ID_CONTADOR}">Observação</label>
      <textarea
        id="observation-${meter.ID_CONTADOR}"
        name="observation-${meter.ID_CONTADOR}"
        maxlength="500"
        rows="3"
        placeholder="Obrigatória quando houver aumento acima do limite"
      ></textarea>
    </div>
    <p class="reading-rule">
      Motivo e observação serão obrigatórios quando o consumo aumentar mais de
      ${increaseLimit}% em relação ao consumo anterior.
    </p>
  `;
  const valueInput = fields.querySelector(`#value-${meter.ID_CONTADOR}`);
  const dateInput = fields.querySelector(`#date-${meter.ID_CONTADOR}`);
  [valueInput, dateInput].forEach((input) => {
    input.addEventListener("input", () => updateJustificationRequirement(meter));
  });
  return fields;
}

function createReasonOptions() {
  return REASONS_BY_CATEGORY.map(
    (category) => `
      <optgroup label="${category.label}">
        ${category.reasons
          .map(
            ([value, label]) =>
              `<option value="${value}">${label}</option>`,
          )
          .join("")}
      </optgroup>
    `,
  ).join("");
}

function updateJustificationRequirement(meter) {
  const dateInput = document.querySelector(`#date-${meter.ID_CONTADOR}`);
  const valueInput = document.querySelector(`#value-${meter.ID_CONTADOR}`);
  const reason = document.querySelector(`#reason-${meter.ID_CONTADOR}`);
  const observation = document.querySelector(
    `#observation-${meter.ID_CONTADOR}`,
  );
  const rule = valueInput
    .closest(".reading-fields")
    .querySelector(".reading-rule");
  const currentReading = Number(valueInput.value);
  const lastReading = Number(meter.ULTIMA_LEITURA);
  const lastConsumption = Number(meter.ULTIMO_CONSUMO);
  const currentConsumption =
    meter.ULTIMA_LEITURA != null ? currentReading - lastReading : null;
  const increaseLimit = meter.TIPO_CONTADOR === "ENERGIA" ? 8 : 5;
  const latestDate = String(meter.DATA_ULTIMA_LEITURA ?? "").slice(0, 10);
  const canCompareConsumption =
    valueInput.value !== "" &&
    dateInput.value !== "" &&
    meter.ULTIMA_LEITURA != null &&
    meter.ULTIMO_CONSUMO != null &&
    Number.isFinite(lastConsumption) &&
    lastConsumption > 0 &&
    dateInput.value > latestDate;
  const increasePercentage =
    canCompareConsumption && currentConsumption != null
      ? ((currentConsumption - lastConsumption) / lastConsumption) * 100
      : null;
  const requiresJustification =
    canCompareConsumption &&
    increasePercentage != null &&
    increasePercentage > increaseLimit;

  reason.required = requiresJustification;
  observation.required = requiresJustification;
  reason.closest(".reading-field").classList.toggle(
    "reading-field--required",
    requiresJustification,
  );
  observation.closest(".reading-field").classList.toggle(
    "reading-field--required",
    requiresJustification,
  );
  rule.classList.toggle("reading-rule--warning", requiresJustification);
  rule.textContent = requiresJustification
    ? `Aumento identificado: consumo atual ${formatReading(
        currentConsumption,
      )} contra consumo anterior ${formatReading(
        lastConsumption,
      )}, variação de ${formatPercentage(
        increasePercentage,
      )}%. Informe motivo e observação.`
    : `Motivo e observação são opcionais quando a variação do consumo não ultrapassa ${increaseLimit}%.`;
}

function renderLoading() {
  readingsActions.hidden = true;
  document.querySelectorAll(".meter-list").forEach((container) => {
    container.innerHTML = `
      <div class="empty-state">
        <strong>Carregando relógios...</strong>
        <span>Aguarde enquanto consultamos os cadastros desta filial.</span>
      </div>
    `;
  });
}

function renderLoadError(message) {
  readingsActions.hidden = true;
  document.querySelectorAll(".meter-list").forEach((container) => {
    const state = document.createElement("div");
    state.className = "empty-state empty-state--error";

    const title = document.createElement("strong");
    title.textContent = "Não foi possível carregar";

    const detail = document.createElement("span");
    detail.textContent = message;

    state.append(title, detail);
    container.replaceChildren(state);
  });
}

function resetForm() {
  meterForm.reset();
  formError.hidden = true;
  formError.textContent = "";
  selectedMeterType = null;
}

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function setButtonLoading(button, loading) {
  button.disabled = loading;
  button.textContent = loading ? "Salvando..." : "Salvar relógio";
}

async function saveReadings(event) {
  event.preventDefault();

  if (!readingsForm.reportValidity()) {
    showMessage({
      type: "warning",
      title: "Preenchimento incompleto",
      message:
        "Informe a data e o valor da leitura de todos os relógios ativos antes de enviar.",
    });
    return;
  }

  const submitButton = readingsForm.querySelector('[type="submit"]');
  const readings = meters.map((meter) => ({
    ID_CONTADOR: meter.ID_CONTADOR,
    DATA_LEITURA: document.querySelector(`#date-${meter.ID_CONTADOR}`).value,
    LEITURA: document.querySelector(`#value-${meter.ID_CONTADOR}`).value,
    MOTIVO: document.querySelector(`#reason-${meter.ID_CONTADOR}`).value,
    OBSERVACAO: document.querySelector(`#observation-${meter.ID_CONTADOR}`).value,
  }));

  try {
    setReadingsButtonLoading(submitButton, true);
    const response = await fetch("/api/leituras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        IDFILIAL_USR: branchId,
        LEITURAS: readings,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Não foi possível gravar as leituras.");
    }

    await loadMeters();
    showMessage({
      type: "success",
      title: "Leituras enviadas",
      message: `${result.message} O formulário foi atualizado com as últimas leituras registradas.`,
    });
  } catch (error) {
    showMessage({
      type: "error",
      title: "Não foi possível enviar",
      message: error.message,
    });
  } finally {
    setReadingsButtonLoading(submitButton, false);
  }
}

function formatReading(value) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(Number(value));
}

function formatPercentage(value) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
  }).format(new Date(value));
}

function setReadingsButtonLoading(button, loading) {
  button.disabled = loading;
  button.textContent = loading ? "Enviando leituras..." : "Enviar todas as leituras";
}

function setLoginButtonLoading(button, loading) {
  button.disabled = loading;
  button.textContent = loading ? "Validando acesso..." : "Entrar";
}

function showMessage({ type = "info", title, message }) {
  const labels = {
    success: "Operação concluída",
    error: "Ocorreu um problema",
    warning: "Atenção necessária",
    info: "Informação",
  };
  const icons = {
    success: "✓",
    error: "!",
    warning: "!",
    info: "i",
  };

  messageDialog.dataset.type = type;
  messageDialogIcon.textContent = icons[type];
  messageDialogEyebrow.textContent = labels[type];
  messageDialogTitle.textContent = title;
  messageDialogText.textContent = message;

  if (!messageDialog.open) {
    messageDialog.showModal();
  }
}

function normalizeBranchCode(value) {
  return String(value ?? "").trim().toUpperCase();
}
