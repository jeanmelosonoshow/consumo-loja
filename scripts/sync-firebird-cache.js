process.env.FIREBIRD_CONNECTION_MODE = "direct";

const [
  { getDashboardAccess, queryFirebird },
  { syncAllDashboardPayments },
  { syncFirebirdUsers },
] = await Promise.all([
  import("../lib/dashboard-access.js"),
  import("../lib/dashboard-payments.js"),
  import("../lib/firebird-users.js"),
]);

async function main() {
  const startedAt = new Date();
  console.log(`[sync] Iniciando sincronizacao Firebird -> Redis em ${startedAt.toISOString()}`);

  const [branches, employees, paymentsCount, usersCount] = await Promise.all([
    loadBranches(),
    loadDashboardEmployees(),
    syncAllDashboardPayments(),
    syncFirebirdUsers(),
  ]);

  const baseBranch = process.env.SYNC_BASE_BRANCH || branches[0]?.codigo;
  if (!baseBranch) {
    throw new Error("Nenhuma filial valida encontrada para aquecer acessos.");
  }

  let accessCount = 0;
  for (const employee of employees) {
    await getDashboardAccess(baseBranch, employee.idfuncionario, {
      forceRefresh: true,
    });
    accessCount += 1;
  }

  console.log(`[sync] Filiais lidas: ${branches.length}`);
  console.log(`[sync] Usuarios de login sincronizados: ${usersCount}`);
  console.log(`[sync] Acessos multifiliais sincronizados: ${accessCount}`);
  console.log(`[sync] Pagamentos sincronizados: ${paymentsCount}`);
  console.log(`[sync] Finalizado em ${new Date().toISOString()}`);
}

async function loadBranches() {
  const rows = await queryFirebird(`
    SELECT IDFILIAL, NOMEFILIAL, CIDADE, UF
    FROM FILIAL
    WHERE IDSUPERVISOR IS NOT NULL
    ORDER BY IDFILIAL
  `, [], { forceRefresh: true });

  return rows
    .map((row) => ({
      codigo: normalizeValue(row.IDFILIAL).toUpperCase(),
      nome: normalizeValue(row.NOMEFILIAL),
      cidade: normalizeValue(row.CIDADE),
      uf: normalizeValue(row.UF).toUpperCase(),
    }))
    .filter((branch) => /^[A-Z0-9]{2}$/.test(branch.codigo));
}

async function loadDashboardEmployees() {
  const rows = await queryFirebird(`
    SELECT IDFUNCIONARIO, CATEGORIA
    FROM FUNCIONARIO
    WHERE STATUS = 'A'
      AND CATEGORIA IN ('DI', 'SU')
    ORDER BY IDFUNCIONARIO
  `, [], { forceRefresh: true });

  return rows
    .map((row) => ({
      idfuncionario: normalizeValue(row.IDFUNCIONARIO),
      categoria: normalizeValue(row.CATEGORIA).toUpperCase(),
    }))
    .filter((employee) => /^[A-Z0-9._-]{1,30}$/.test(employee.idfuncionario));
}

function normalizeValue(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString("utf8").trim();
  }
  return String(value ?? "").trim();
}

main().catch((error) => {
  console.error("[sync] Falha na sincronizacao Firebird -> Redis:", error);
  process.exitCode = 1;
});
