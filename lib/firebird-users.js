import crypto from "crypto";
import { canUseDirectFirebird } from "./firebird-cache-config.js";
import { queryFirebird } from "./dashboard-access.js";
import {
  cacheTtlSeconds,
  createCacheKey,
  getJsonCache,
  getStaleJsonCache,
  setJsonCache,
} from "./redis-cache.js";

export async function findUserByLogin(usuario, senha) {
  const normalizedUser = normalizeText(usuario);
  const senhaHash = hashPassword(senha);
  if (!normalizedUser || !senhaHash) return null;

  const cacheKey = loginCacheKey(normalizedUser, senhaHash);
  const cached = await getJsonCache(cacheKey);
  if (cached) return normalizeUser(cached);

  if (!canUseDirectFirebird()) {
    const stale = await getStaleJsonCache(cacheKey);
    return stale.hit ? normalizeUser(stale.value) : null;
  }

  const rows = await queryFirebird(`
    SELECT
      IDFUNCIONARIO AS ID_FUNCIONARIO,
      NOMEFUNCIONARIO AS NOME_FUNCIONARIO,
      IDFILIAL AS ID_FILIAL,
      CATEGORIA
    FROM FUNCIONARIO
    WHERE LOGIN = ?
      AND SENHAWEB = ?
      AND STATUS = 'A'
  `, [normalizedUser, senhaHash], { forceRefresh: true });

  if (!rows.length) return null;

  const user = normalizeUser({
    idfuncionario: rows[0].ID_FUNCIONARIO,
    nomefuncionario: rows[0].NOME_FUNCIONARIO,
    idfilial: rows[0].ID_FILIAL,
    categoria: rows[0].CATEGORIA,
  });

  await setUserLoginCache(normalizedUser, senhaHash, user);
  return user;
}

export async function syncFirebirdUsers() {
  const rows = await queryFirebird(`
    SELECT
      LOGIN,
      SENHAWEB,
      IDFUNCIONARIO AS ID_FUNCIONARIO,
      NOMEFUNCIONARIO AS NOME_FUNCIONARIO,
      IDFILIAL AS ID_FILIAL,
      CATEGORIA
    FROM FUNCIONARIO
    WHERE STATUS = 'A'
      AND LOGIN IS NOT NULL
      AND SENHAWEB IS NOT NULL
  `, [], { forceRefresh: true, skipCacheWrite: true });

  let count = 0;
  for (const row of rows) {
    const usuario = normalizeText(row.LOGIN);
    const senhaHash = normalizeText(row.SENHAWEB).toLowerCase();
    const user = normalizeUser({
      idfuncionario: row.ID_FUNCIONARIO,
      nomefuncionario: row.NOME_FUNCIONARIO,
      idfilial: row.ID_FILIAL,
      categoria: row.CATEGORIA,
    });

    if (!usuario || !senhaHash || !user?.idfuncionario) continue;

    await setUserLoginCache(usuario, senhaHash, user);
    count += 1;
  }

  return count;
}

function setUserLoginCache(usuario, senhaHash, user) {
  return setJsonCache(loginCacheKey(usuario, senhaHash), user, {
    ttlSeconds: cacheTtlSeconds(),
  });
}

function loginCacheKey(usuario, senhaHash) {
  return createCacheKey("firebird-login", {
    usuario: normalizeText(usuario),
    senhaHash: normalizeText(senhaHash).toLowerCase(),
  });
}

function hashPassword(senha) {
  const normalizedPassword = normalizeText(senha);
  if (!normalizedPassword) return "";

  return crypto
    .createHash("md5")
    .update(normalizedPassword)
    .digest("hex")
    .toLowerCase();
}

function normalizeUser(user) {
  if (!user) return null;

  return {
    idfuncionario: normalizeValue(user.idfuncionario),
    nomefuncionario: normalizeValue(user.nomefuncionario),
    idfilial: normalizeBranchId(user.idfilial),
    categoria: normalizeValue(user.categoria).toUpperCase(),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBranchId(value) {
  const code = normalizeValue(value).toUpperCase();
  return /^[A-Z0-9]{2}$/.test(code) ? code : "";
}

function normalizeValue(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString("utf8").trim();
  }
  return String(value ?? "").trim();
}
