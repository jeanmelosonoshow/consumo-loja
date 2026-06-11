import { neon } from "@neondatabase/serverless";

const TIPOS_VALIDOS = new Set(["ENERGIA", "AGUA"]);
const CODIGO_FILIAL_VALIDO = /^[A-Za-z0-9._-]{1,30}$/;

export default async function handler(request, response) {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    return response.status(500).json({
      message: "A conexão com o banco de dados não está configurada.",
    });
  }

  const sql = neon(connectionString);

  try {
    if (request.method === "GET") {
      return await listMeters(request, response, sql);
    }

    if (request.method === "POST") {
      return await createMeter(request, response, sql);
    }

    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ message: "Método não permitido." });
  } catch (error) {
    console.error("Erro na API de contadores:", error);

    if (error.code === "42P01") {
      return response.status(500).json({
        message: "A tabela cadastro_contador ainda não existe no banco.",
      });
    }

    return response.status(500).json({
      message: "Não foi possível acessar o banco de dados.",
    });
  }
}

async function listMeters(request, response, sql) {
  const filial = normalizeText(request.query.filial);

  if (!isValidBranch(filial)) {
    return response.status(400).json({ message: "Código da filial inválido." });
  }

  const meters = await sql`
    SELECT
      id_contador AS "ID_CONTADOR",
      idfilial_usr AS "IDFILIAL_USR",
      apelido_contador AS "APELIDO_CONTADOR",
      numero_contador AS "NUMERO_CONTADOR",
      tipo_contador AS "TIPO_CONTADOR",
      status AS "STATUS",
      data_cadastro AS "DATA_CADASTRO",
      ultima_leitura.leitura AS "ULTIMA_LEITURA",
      ultima_leitura.data_leitura AS "DATA_ULTIMA_LEITURA",
      ultima_leitura.consumo AS "ULTIMO_CONSUMO"
    FROM cadastro_contador AS contador
    LEFT JOIN LATERAL (
      SELECT
        leitura,
        data_leitura,
        CASE
          WHEN leitura_anterior IS NULL THEN NULL
          ELSE leitura - leitura_anterior
        END AS consumo
      FROM leitura_contador
      WHERE id_contador = contador.id_contador
      ORDER BY data_leitura DESC
      LIMIT 1
    ) AS ultima_leitura ON TRUE
    WHERE contador.idfilial_usr = ${filial}
      AND contador.status = 'T'
    ORDER BY tipo_contador, apelido_contador
  `;

  return response.status(200).json(meters);
}

async function createMeter(request, response, sql) {
  const filial = normalizeText(request.body?.IDFILIAL_USR);
  const nickname = normalizeText(request.body?.APELIDO_CONTADOR);
  const number = normalizeText(request.body?.NUMERO_CONTADOR);
  const type = normalizeText(request.body?.TIPO_CONTADOR).toUpperCase();

  if (!isValidBranch(filial)) {
    return response.status(400).json({ message: "Código da filial inválido." });
  }

  if (!nickname || nickname.length > 60) {
    return response.status(400).json({
      message: "Informe um apelido com até 60 caracteres.",
    });
  }

  if (!number || number.length > 50) {
    return response.status(400).json({
      message: "Informe um número de relógio com até 50 caracteres.",
    });
  }

  if (!TIPOS_VALIDOS.has(type)) {
    return response.status(400).json({ message: "Tipo de contador inválido." });
  }

  try {
    const [meter] = await sql`
      INSERT INTO cadastro_contador (
        idfilial_usr,
        apelido_contador,
        numero_contador,
        tipo_contador,
        status
      )
      VALUES (${filial}, ${nickname}, ${number}, ${type}, 'T')
      RETURNING
        id_contador AS "ID_CONTADOR",
        idfilial_usr AS "IDFILIAL_USR",
        apelido_contador AS "APELIDO_CONTADOR",
        numero_contador AS "NUMERO_CONTADOR",
        tipo_contador AS "TIPO_CONTADOR",
        status AS "STATUS",
        data_cadastro AS "DATA_CADASTRO"
    `;

    return response.status(201).json(meter);
  } catch (error) {
    if (error.code === "23505") {
      return response.status(409).json({
        message: "Este número de relógio já está cadastrado nesta filial.",
      });
    }

    throw error;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidBranch(value) {
  return CODIGO_FILIAL_VALIDO.test(value);
}
