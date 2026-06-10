const params = new URLSearchParams(window.location.search);
const branchId =
  params.get("$a_system_user_unit_code") ??
  params.get("a_system_user_unit_code") ??
  params.get("IDFILIAL_USR") ??
  params.get("idfilial_usr") ??
  "";
const branchLabel =
  params.get("NOME_FILIAL") ?? params.get("nome_filial") ?? branchId;

const dialog = document.querySelector("#meter-dialog");
const meterForm = document.querySelector("#meter-form");
const dialogTitle = document.querySelector("#dialog-title");
const formError = document.querySelector("#form-error");
const toast = document.querySelector("#toast");
const readingsForm = document.querySelector("#readings-form");
const readingsActions = document.querySelector("#readings-actions");
let selectedMeterType = null;
let meters = [];

initialize();

function initialize() {
  document.querySelector("#reference-date").textContent =
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
    }).format(new Date());

  document.querySelector("#branch-name").textContent =
    branchLabel || "Não identificada";
  document.querySelector("#missing-branch").hidden = Boolean(branchId);

  document.querySelectorAll("[data-open-meter]").forEach((button) => {
    button.disabled = !branchId;
    button.addEventListener("click", () => openMeterDialog(button.dataset.openMeter));
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });

  meterForm.addEventListener("submit", saveMeter);
  readingsForm.addEventListener("submit", validateReadings);
  dialog.addEventListener("close", resetForm);
  initializeHeightReporting();
  loadMeters();
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
    showToast(`${nickname} foi cadastrado com sucesso.`);
  } catch (error) {
    showFormError(error.message);
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
      lastReading.innerHTML = `
        <span>Última leitura</span>
        <strong>Nenhuma leitura registrada</strong>
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
        step="0.001"
        inputmode="decimal"
        placeholder="0,000"
        required
      />
    </div>
    <div class="reading-field reading-field--wide">
      <label for="reason-${meter.ID_CONTADOR}">Motivo</label>
      <select
        id="reason-${meter.ID_CONTADOR}"
        name="reason-${meter.ID_CONTADOR}"
      >
        <option value="">Motivos serão carregados do cadastro</option>
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
      Motivo e observação serão obrigatórios quando a leitura ultrapassar o
      percentual de aumento definido.
    </p>
  `;
  return fields;
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 3000);
}

function setButtonLoading(button, loading) {
  button.disabled = loading;
  button.textContent = loading ? "Salvando..." : "Salvar relógio";
}

function initializeHeightReporting() {
  const reportHeight = () => {
    window.parent.postMessage(
      {
        type: "consumo-loja:height",
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

function validateReadings(event) {
  event.preventDefault();

  if (!readingsForm.reportValidity()) {
    showToast("Preencha a data e o valor de todos os relógios.");
    return;
  }

  showToast(
    "Todos os campos obrigatórios foram preenchidos. A gravação das leituras será a próxima etapa.",
  );
}
