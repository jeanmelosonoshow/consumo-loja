import { createRequire } from "module";
import { canUseDirectFirebird } from "./firebird-cache-config.js";
import {
  acquireCacheLock,
  cacheTtlSeconds,
  createCacheKey,
  getJsonCache,
  getJsonCacheEntry,
  getStaleJsonCache,
  releaseCacheLock,
  setJsonCache,
  waitForJsonCache,
} from "./redis-cache.js";

const require = createRequire(import.meta.url);
const Firebird = require("node-firebird");
const CODIGO_FILIAL_VALIDO = /^[A-Z0-9]{2}$/;
const CODIGO_FUNCIONARIO_VALIDO = /^[A-Z0-9._-]{1,30}$/;
const accessCache = globalThis.__consumoDashboardAccessCache ?? new Map();
globalThis.__consumoDashboardAccessCache = accessCache;

export async function getDashboardAccess(baseBranch, employeeCode, options = {}) {
  const filial = normalize(baseBranch);
  const funcionario = normalize(employeeCode);

  if (!CODIGO_FILIAL_VALIDO.test(filial)) {
    throw new AccessError("Código da filial inválido.", 400);
  }

  const cacheKey = `${filial}:${funcionario}`;
  const redisCacheKey = createCacheKey("dashboard-access", {
    filial,
    funcionario,
  });

  const employeeCacheKey = createCacheKey("dashboard-access-employee", {
    funcionario,
  });

  if (!options.forceRefresh) {
    if (CODIGO_FUNCIONARIO_VALIDO.test(funcionario)) {
      const employeeAccess = await getJsonCache(employeeCacheKey);
      if (employeeAccess?.filiais?.length) {
        await cacheAccess(cacheKey, employeeAccess, redisCacheKey);
        return employeeAccess;
      }
    }

    const cached = accessCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const cachedAccess = await getJsonCache(redisCacheKey);
    if (cachedAccess) {
      await cacheAccess(cacheKey, cachedAccess);
      return cachedAccess;
    }
  }

  if (!funcionario || !CODIGO_FUNCIONARIO_VALIDO.test(funcionario)) {
    const access = singleBranchAccess({
      codigo: filial,
      nome: `Filial ${filial}`,
      cidade: "",
      uf: "",
    });
    await cacheAccess(cacheKey, access, redisCacheKey);
    return access;
  }

  if (!canUseDirectFirebird()) {
    return singleBranchAccess({
      codigo: filial,
      nome: `Filial ${filial}`,
      cidade: "",
      uf: "",
    });
  }

  const database = await attachFirebird();

  try {
    const employees = await query(database, `
      SELECT IDFUNCIONARIO, CATEGORIA, IDFILIAL
      FROM FUNCIONARIO
      WHERE STATUS = 'A'
        AND IDFUNCIONARIO = ?
    `, [funcionario]);
    const category = normalize(employees[0]?.CATEGORIA);

    if (!employees.length || !["DI", "SU", "GR"].includes(category)) {
      const branch = await findBranch(database, filial);
      const access = singleBranchAccess(branch, category || null, funcionario);
      await cacheAccess(cacheKey, access, redisCacheKey);
      return access;
    }

    if (category === "GR") {
      const branchCode = normalize(employees[0]?.IDFILIAL) || filial;
      const access = singleBranchAccess(
        await findBranch(database, branchCode),
        category,
        funcionario,
      );
      await cacheAccess(cacheKey, access, redisCacheKey);
      await setJsonCache(employeeCacheKey, access, {
        ttlSeconds: cacheTtlSeconds(),
        staleTtlSeconds: 0,
      });
      return access;
    }

    const branches = category === "DI"
      ? await query(database, `
          SELECT IDFILIAL, NOMEFILIAL, CIDADE, UF
          FROM FILIAL
          WHERE IDSUPERVISOR IS NOT NULL
          ORDER BY IDFILIAL
        `)
      : await query(database, `
          SELECT F.IDFILIAL, F.NOMEFILIAL, F.CIDADE, F.UF
          FROM FILIAL F
          JOIN FUNCIONARIO FU ON FU.IDFUNCIONARIO = F.IDSUPERVISOR
          WHERE F.IDSUPERVISOR IS NOT NULL
            AND FU.IDFUNCIONARIO = ?
          ORDER BY F.IDFILIAL
        `, [funcionario]);

    const normalizedBranches = branches
      .map(normalizeBranch)
      .filter((branch) => CODIGO_FILIAL_VALIDO.test(branch.codigo));

    const access = {
      categoria: category,
      idfuncionario: funcionario,
      multiplaSelecao: true,
      filiais: normalizedBranches.length
        ? normalizedBranches
        : singleBranchAccess(
            await findBranch(database, filial),
            category,
            funcionario,
          ).filiais,
    };
    await cacheAccess(cacheKey, access, redisCacheKey);
    await setJsonCache(employeeCacheKey, access, {
      ttlSeconds: cacheTtlSeconds(),
      staleTtlSeconds: 0,
    });
    return access;
  } finally {
    database.detach();
  }
}

export function selectAuthorizedBranches(access, requestedBranches) {
  const authorized = new Set(access.filiais.map((branch) => branch.codigo));
  const requested = String(requestedBranches ?? "")
    .split(",")
    .map(normalize)
    .filter((branch) => CODIGO_FILIAL_VALIDO.test(branch));
  const selected = [...new Set(requested)].filter((branch) => authorized.has(branch));

  return selected.length ? selected : [access.filiais[0].codigo];
}

export async function queryFirebird(sql, params = [], options = {}) {
  const cacheKey = createCacheKey("firebird-query", { sql, params });
  if (!options.forceRefresh) {
    const cachedRows = await getJsonCacheEntry(cacheKey);
    if (cachedRows.hit) return cachedRows.value;
  }

  if (!canUseDirectFirebird()) {
    const staleRows = await getStaleJsonCache(cacheKey);
    if (staleRows.hit) return staleRows.value;

    throw new AccessError(
      "Os dados do Firebird ainda não foram sincronizados com o Redis.",
      503,
    );
  }

  const lock = await acquireCacheLock(cacheKey);
  if (!lock.acquired) {
    const sharedRows = await waitForJsonCache(cacheKey);
    if (sharedRows.hit) return sharedRows.value;

    const staleRows = await getStaleJsonCache(cacheKey);
    if (staleRows.hit) return staleRows.value;
  }

  let lastError;

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const database = await attachFirebird();
      try {
        const rows = await query(database, sql, params);
        if (!options.skipCacheWrite) {
          await setJsonCache(cacheKey, rows);
        }
        return rows;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await wait(350);
      } finally {
        database.detach();
      }
    }

    const staleRows = await getStaleJsonCache(cacheKey);
    if (staleRows.hit) {
      console.error("Usando cache Redis expirado após falha no Firebird:", lastError);
      return staleRows.value;
    }

    throw lastError;
  } finally {
    if (lock.acquired) {
      await releaseCacheLock(cacheKey, lock.token);
    }
  }
}

async function findBranch(database, filial) {
  const rows = await query(database, `
    SELECT IDFILIAL, NOMEFILIAL, CIDADE, UF
    FROM FILIAL
    WHERE IDFILIAL = ?
  `, [filial]);
  return rows.length
    ? normalizeBranch(rows[0])
    : { codigo: filial, nome: `Filial ${filial}`, cidade: "", uf: "" };
}

function singleBranchAccess(branch, category = null, employeeCode = null) {
  return {
    categoria: category,
    idfuncionario: employeeCode,
    multiplaSelecao: false,
    filiais: [branch],
  };
}

function normalizeBranch(row) {
  return {
    codigo: normalizeValue(row.IDFILIAL).toUpperCase(),
    nome: normalizeValue(row.NOMEFILIAL),
    cidade: normalizeValue(row.CIDADE),
    uf: normalizeValue(row.UF).toUpperCase(),
  };
}

function attachFirebird() {
  const required = [
    "DB_HOST_FB",
    "DB_PORT_FB",
    "DB_PATH_FB",
    "DB_USER_FB",
    "DB_PASSWORD_FB",
  ];

  if (required.some((name) => !process.env[name])) {
    throw new AccessError("A conexão com o ERP não está configurada.", 500);
  }

  return attachWithRetry(3);
}

async function attachWithRetry(maxAttempts) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await attachOnce();
    } catch (error) {
      lastError = error;
      console.error(`Falha ao conectar ao ERP (tentativa ${attempt}):`, error);
      if (attempt < maxAttempts) await wait(attempt * 400);
    }
  }

  throw new AccessError(
    "O ERP está temporariamente indisponível. Tente novamente em alguns segundos.",
    503,
  );
}

function attachOnce() {
  return new Promise((resolve, reject) => {
    Firebird.attach(
      {
        host: process.env.DB_HOST_FB,
        port: Number(process.env.DB_PORT_FB),
        database: process.env.DB_PATH_FB,
        user: process.env.DB_USER_FB,
        password: process.env.DB_PASSWORD_FB,
        lowercase_keys: false,
        pageSize: 4096,
      },
      (error, database) => (error ? reject(error) : resolve(database)),
    );
  });
}

function query(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.query(sql, params, (error, rows) => {
      if (error) return reject(error);
      return resolve(rows ?? []);
    });
  });
}

function normalize(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeValue(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString("utf8").trim();
  }
  return String(value ?? "").trim();
}

async function cacheAccess(key, value, redisCacheKey = null) {
  accessCache.set(key, {
    value,
    expiresAt: Date.now() + cacheTtlSeconds() * 1000,
  });

  if (redisCacheKey) {
    await setJsonCache(redisCacheKey, value, {
      ttlSeconds: cacheTtlSeconds(),
      staleTtlSeconds: 0,
    });
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class AccessError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}
