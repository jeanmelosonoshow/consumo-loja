import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Firebird = require("node-firebird");
const CODIGO_FILIAL_VALIDO = /^[A-Z0-9]{2}$/;
const CODIGO_FUNCIONARIO_VALIDO = /^[A-Z0-9._-]{1,30}$/;

export async function getDashboardAccess(baseBranch, employeeCode) {
  const filial = normalize(baseBranch);
  const funcionario = normalize(employeeCode);

  if (!CODIGO_FILIAL_VALIDO.test(filial)) {
    throw new AccessError("Código da filial inválido.", 400);
  }

  if (!funcionario) {
    return findSingleBranchAccess(filial);
  }

  if (!CODIGO_FUNCIONARIO_VALIDO.test(funcionario)) {
    throw new AccessError("Código do funcionário inválido.", 400);
  }

  const database = await attachFirebird();

  try {
    const employees = await query(database, `
      SELECT IDFUNCIONARIO, CATEGORIA
      FROM FUNCIONARIO
      WHERE STATUS = 'A'
        AND IDFUNCIONARIO = ?
    `, [funcionario]);
    const category = normalize(employees[0]?.CATEGORIA);

    if (!employees.length || !["DI", "SU"].includes(category)) {
      const branch = await findBranch(database, filial);
      return singleBranchAccess(branch, category || null, funcionario);
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

    return {
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

export async function queryFirebird(sql, params = []) {
  const database = await attachFirebird();
  try {
    return await query(database, sql, params);
  } finally {
    database.detach();
  }
}

async function findSingleBranchAccess(filial) {
  const database = await attachFirebird();
  try {
    return singleBranchAccess(await findBranch(database, filial));
  } finally {
    database.detach();
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
      (error, database) => {
        if (error) return reject(new AccessError("Não foi possível conectar ao ERP.", 503));
        return resolve(database);
      },
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
  return String(value ?? "").trim();
}

export class AccessError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}
