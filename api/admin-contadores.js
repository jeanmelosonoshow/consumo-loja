import { neon } from "@neondatabase/serverless";
import { handleAdminError, requireAdmin } from "../lib/admin-auth.js";

const STATUS_VALIDOS = new Set(["T", "F"]);
const CODIGO_FILIAL_VALIDO = /^[A-Za-z0-9._-]{1,30}$/;

export default async function handler(request, response) {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    return response.status(500).json({ message: "A conexão com o banco de dados não está configurada." });
  }

  try {
    requireAdmin(request);
    const sql = neon(connectionString);

    if (request.method === "GET") return await listMeters(request, response, sql);
    if (request.method === "PATCH") return await updateMeter(request, response, sql);

    response.setHeader("Allow", "GET, PATCH");
    return response.status(405).json({ message: "Método não permitido." });
  } catch (error) {
    return handleAdminError(error, response);
  }
}

async function listMeters(request, response, sql) {
  const filial = normalizeText(request.query.filial).toUpperCase();
  const hasBranchFilter = filial !== "";

  if (hasBranchFilter && !CODIGO_FILIAL_VALIDO.test(filial)) {
    return response.status(400).json({ message: "Código da filial inválido." });
  }

  const meters = await sql`
    SELECT
      c.id_contador AS "ID_CONTADOR",
      c.idfilial_usr AS "IDFILIAL_USR",
      c.apelido_contador AS "APELIDO_CONTADOR",
      c.numero_contador AS "NUMERO_CONTADOR",
      c.tipo_contador AS "TIPO_CONTADOR",
      c.status AS "STATUS",
      c.data_cadastro AS "DATA_CADASTRO",
      ultima.data_leitura AS "DATA_ULTIMA_LEITURA",
      ultima.leitura AS "ULTIMA_LEITURA"
    FROM cadastro_contador c
    LEFT JOIN LATERAL (
      SELECT data_leitura, leitura
      FROM leitura_contador l
      WHERE l.id_contador = c.id_contador
      ORDER BY data_leitura DESC
      LIMIT 1
    ) ultima ON TRUE
    WHERE (${hasBranchFilter} = false OR c.idfilial_usr = ${filial})
    ORDER BY c.idfilial_usr, c.tipo_contador, c.apelido_contador
    LIMIT 800
  `;

  return response.status(200).json({ contadores: meters });
}

async function updateMeter(request, response, sql) {
  const id = Number(request.body?.ID_CONTADOR);
  const nickname = normalizeText(request.body?.APELIDO_CONTADOR);
  const number = normalizeText(request.body?.NUMERO_CONTADOR);
  const status = normalizeText(request.body?.STATUS).toUpperCase();

  if (!Number.isInteger(id) || id <= 0) {
    return response.status(400).json({ message: "Contador inválido." });
  }

  if (!nickname || nickname.length > 60) {
    return response.status(400).json({ message: "Informe um apelido com até 60 caracteres." });
  }

  if (!number || number.length > 50) {
    return response.status(400).json({ message: "Informe um número com até 50 caracteres." });
  }

  if (!STATUS_VALIDOS.has(status)) {
    return response.status(400).json({ message: "Status inválido." });
  }

  const [meter] = await sql`
    UPDATE cadastro_contador
       SET apelido_contador = ${nickname},
           numero_contador = ${number},
           status = ${status}
     WHERE id_contador = ${id}
     RETURNING
       id_contador AS "ID_CONTADOR",
       idfilial_usr AS "IDFILIAL_USR",
       apelido_contador AS "APELIDO_CONTADOR",
       numero_contador AS "NUMERO_CONTADOR",
       tipo_contador AS "TIPO_CONTADOR",
       status AS "STATUS",
       data_cadastro AS "DATA_CADASTRO"
  `;

  if (!meter) return response.status(404).json({ message: "Contador não encontrado." });
  return response.status(200).json({ message: "Relógio atualizado com sucesso.", contador: meter });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
