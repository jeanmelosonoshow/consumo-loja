import crypto from "crypto";
import fs from "fs";

const CONFIG_URL = new URL("./admin-funcionarios.json", import.meta.url);
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export function isAdminEmployee(employeeId) {
  const allowed = loadAllowedEmployees();
  return allowed.has(normalizeEmployeeId(employeeId));
}

export function createAdminToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    idfuncionario: normalizeEmployeeId(user.idfuncionario),
    nomefuncionario: String(user.nomefuncionario ?? ""),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function requireAdmin(request) {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    throw createAuthError("Acesso administrativo não autenticado.", 401);
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || sign(encodedPayload) !== signature) {
    throw createAuthError("Sessão administrativa inválida.", 401);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw createAuthError("Sessão administrativa inválida.", 401);
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw createAuthError("Sessão administrativa expirada.", 401);
  }

  if (!isAdminEmployee(payload.idfuncionario)) {
    throw createAuthError("Funcionário sem permissão administrativa.", 403);
  }

  return payload;
}

export function handleAdminError(error, response) {
  if (error.statusCode) {
    return response.status(error.statusCode).json({ message: error.message });
  }
  console.error("Erro administrativo:", error);
  return response.status(500).json({ message: "Não foi possível concluir a operação administrativa." });
}

function loadAllowedEmployees() {
  const config = JSON.parse(fs.readFileSync(CONFIG_URL, "utf8"));
  return new Set(
    (config.funcionariosPermitidos ?? [])
      .map(normalizeEmployeeId)
      .filter(Boolean),
  );
}

function normalizeEmployeeId(value) {
  return String(value ?? "").trim().toUpperCase();
}

function getSecret() {
  return (
    process.env.ADMIN_TOKEN_SECRET ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    "consumo-loja-admin-local"
  );
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function createAuthError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
