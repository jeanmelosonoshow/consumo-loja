const ADMIN_STORAGE_KEY = "consumo-loja:admin";
const ADMIN_LOGIN_URL = "/admin.html";
const ADMIN_PANEL_URL = "/admin-painel.html";
const REQUEST_TIMEOUT_MS = 25000;
const loginScreen = document.querySelector("#login-screen");
const adminApp = document.querySelector("#admin-app");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const adminUser = document.querySelector("#admin-user");
const adminMessage = document.querySelector("#admin-message");
const logoutButton = document.querySelector("#logout-button");
const metersFilter = document.querySelector("#meters-filter");
const readingsFilter = document.querySelector("#readings-filter");
const metersTable = document.querySelector("#meters-table");
const readingsTable = document.querySelector("#readings-table");
let session = getSession();

initialize();

function initialize() {
  if (loginForm) {
    initializeLoginPage();
    return;
  }

  if (adminApp) {
    initializeAdminPage();
  }
}

function initializeLoginPage() {
  if (session?.token) {
    window.location.replace(ADMIN_PANEL_URL);
    return;
  }

  loginForm.addEventListener("submit", login);
  loginScreen.hidden = false;
}

function initializeAdminPage() {
  if (!session?.token) {
    window.location.replace(ADMIN_LOGIN_URL);
    return;
  }

  logoutButton.addEventListener("click", logout);
  metersFilter.addEventListener("submit", (event) => {
    event.preventDefault();
    loadMeters().catch((error) => showMessage(error.message, true));
  });
  readingsFilter.addEventListener("submit", (event) => {
    event.preventDefault();
    loadReadings().catch((error) => showMessage(error.message, true));
  });
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  adminUser.textContent = `${session.nomefuncionario || "Funcionário"} · ${session.idfuncionario}`;
  loadMeters().catch((error) => showMessage(error.message, true));
}

async function login(event) {
  event.preventDefault();
  loginError.hidden = true;
  const submit = loginForm.querySelector("button");
  const formData = new FormData(loginForm);

  try {
    setLoading(submit, true);
    loginError.textContent = "Validando acesso administrativo...";
    loginError.classList.remove("message--error");
    loginError.hidden = false;
    const response = await fetchWithTimeout("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: formData.get("usuario"),
        senha: formData.get("senha"),
      }),
    });
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(result.message);

    session = {
      token: result.token,
      idfuncionario: result.idfuncionario,
      nomefuncionario: result.nomefuncionario,
    };
    sessionStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(session));
    window.location.href = ADMIN_PANEL_URL;
  } catch (error) {
    loginError.textContent = error.message || "Não foi possível entrar no admin.";
    loginError.classList.add("message--error");
    loginError.hidden = false;
  } finally {
    setLoading(submit, false);
  }
}

function logout() {
  sessionStorage.removeItem(ADMIN_STORAGE_KEY);
  session = null;
  window.location.href = ADMIN_LOGIN_URL;
}

function switchTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("tab--active", button.dataset.tab === tab);
  });
  document.querySelector("#meters-panel").hidden = tab !== "meters";
  document.querySelector("#readings-panel").hidden = tab !== "readings";
  if (tab === "readings" && !readingsTable.children.length) {
    loadReadings().catch((error) => showMessage(error.message, true));
  }
}

async function loadMeters() {
  metersTable.innerHTML = '<tr><td class="empty-row" colspan="8">Carregando relógios...</td></tr>';
  const query = new URLSearchParams(new FormData(metersFilter));
  const data = await apiFetch(`/api/admin-contadores?${query}`);

  if (!data.contadores.length) {
    metersTable.innerHTML = '<tr><td class="empty-row" colspan="8">Nenhum relógio encontrado.</td></tr>';
    return;
  }

  metersTable.replaceChildren(
    ...data.contadores.map((meter) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(meter.ID_CONTADOR)}</td>
        <td>${escapeHtml(meter.IDFILIAL_USR)}</td>
        <td>${meter.TIPO_CONTADOR === "ENERGIA" ? "Energia" : "Água"}</td>
        <td><input data-field="APELIDO_CONTADOR" value="${escapeAttribute(meter.APELIDO_CONTADOR)}" maxlength="60"></td>
        <td><input data-field="NUMERO_CONTADOR" value="${escapeAttribute(meter.NUMERO_CONTADOR)}" maxlength="50"></td>
        <td>
          <select data-field="STATUS">
            <option value="T" ${meter.STATUS === "T" ? "selected" : ""}>Ativo</option>
            <option value="F" ${meter.STATUS === "F" ? "selected" : ""}>Inativo</option>
          </select>
          <span class="status-pill ${meter.STATUS === "T" ? "status-pill--active" : "status-pill--inactive"}">
            ${meter.STATUS === "T" ? "T" : "F"}
          </span>
        </td>
        <td>${meter.ULTIMA_LEITURA == null ? "-" : `${formatNumber(meter.ULTIMA_LEITURA)} em ${formatDate(meter.DATA_ULTIMA_LEITURA)}`}</td>
        <td><button class="button button--primary" type="button">Salvar</button></td>
      `;
      row.querySelector("button").addEventListener("click", () => saveMeter(row, meter.ID_CONTADOR));
      return row;
    }),
  );
}

async function saveMeter(row, id) {
  const button = row.querySelector("button");
  const payload = { ID_CONTADOR: id };
  row.querySelectorAll("[data-field]").forEach((input) => {
    payload[input.dataset.field] = input.value;
  });

  try {
    setLoading(button, true);
    await apiFetch("/api/admin-contadores", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    showMessage("Relógio atualizado com sucesso.");
    await loadMeters();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setLoading(button, false);
  }
}

async function loadReadings() {
  readingsTable.innerHTML = '<tr><td class="empty-row" colspan="8">Carregando leituras...</td></tr>';
  const query = new URLSearchParams(new FormData(readingsFilter));
  const data = await apiFetch(`/api/admin-leituras?${query}`);

  if (!data.leituras.length) {
    readingsTable.innerHTML = '<tr><td class="empty-row" colspan="8">Nenhuma leitura encontrada.</td></tr>';
    return;
  }

  readingsTable.replaceChildren(
    ...data.leituras.map((reading) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(reading.ID_LEITURA)}</td>
        <td>${escapeHtml(reading.IDFILIAL_USR)}</td>
        <td>${escapeHtml(reading.ID_CONTADOR)} · ${escapeHtml(reading.APELIDO_CONTADOR)}</td>
        <td>${reading.TIPO_CONTADOR === "ENERGIA" ? "Energia" : "Água"}</td>
        <td>${formatDate(reading.DATA_LEITURA)}</td>
        <td><input data-field="LEITURA" type="number" min="0" step="1" value="${escapeAttribute(formatRawNumber(reading.LEITURA))}"></td>
        <td>${reading.LEITURA_ANTERIOR == null ? "-" : formatNumber(reading.LEITURA_ANTERIOR)}</td>
        <td><button class="button button--primary" type="button">Corrigir</button></td>
      `;
      row.querySelector("button").addEventListener("click", () => saveReading(row, reading.ID_LEITURA));
      return row;
    }),
  );
}

async function saveReading(row, id) {
  const button = row.querySelector("button");
  const value = row.querySelector('[data-field="LEITURA"]').value;

  if (!confirm("Confirma a correção desta leitura? A data será marcada para nova sincronização.")) {
    return;
  }

  try {
    setLoading(button, true);
    await apiFetch("/api/admin-leituras", {
      method: "PATCH",
      body: JSON.stringify({ ID_LEITURA: id, LEITURA: Number(value) }),
    });
    showMessage("Leitura corrigida com sucesso.");
    await loadReadings();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setLoading(button, false);
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.token ?? ""}`,
      ...(options.headers ?? {}),
    },
  });
  const data = await readJsonResponse(response);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) logout();
    throw new Error(data.message || "Não foi possível concluir a operação.");
  }
  return data;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("A API demorou para responder. Verifique a conexão com o ERP e tente novamente.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      message: response.ok
        ? "Resposta inválida recebida da API."
        : "A API retornou uma resposta inválida. Verifique se a versão publicada está atualizada.",
    };
  }
}

function showMessage(message, error = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle("message--error", error);
  adminMessage.hidden = false;
  window.setTimeout(() => {
    adminMessage.hidden = true;
  }, 6000);
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(ADMIN_STORAGE_KEY));
  } catch {
    sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    return null;
  }
}

function setLoading(button, loading) {
  button.disabled = loading;
  button.dataset.originalText ??= button.textContent;
  button.textContent = loading ? "Aguarde..." : button.dataset.originalText;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatRawNumber(value) {
  return String(Math.round(Number(value) || 0));
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
