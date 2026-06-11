import { createRequire } from "module";
import crypto from "crypto";

const require = createRequire(import.meta.url);
const Firebird = require("node-firebird");

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ message: "Método não permitido." });
  }

  const usuario = normalizeText(request.body?.usuario);
  const senha = normalizeText(request.body?.senha);

  if (!usuario || !senha) {
    return response.status(400).json({
      autorizado: false,
      message: "Informe o usuário e a senha.",
    });
  }

  const requiredVariables = [
    "DB_HOST_FB",
    "DB_PORT_FB",
    "DB_PATH_FB",
    "DB_USER_FB",
    "DB_PASSWORD_FB",
  ];
  const missingVariable = requiredVariables.find((name) => !process.env[name]);

  if (missingVariable) {
    return response.status(500).json({
      autorizado: false,
      message: "A conexão com o ERP não está configurada neste projeto.",
    });
  }

  const senhaHash = crypto
    .createHash("md5")
    .update(senha)
    .digest("hex")
    .toLowerCase();
  const options = {
    host: process.env.DB_HOST_FB,
    port: Number(process.env.DB_PORT_FB),
    database: process.env.DB_PATH_FB,
    user: process.env.DB_USER_FB,
    password: process.env.DB_PASSWORD_FB,
    lowercase_keys: false,
    pageSize: 4096,
  };

  return new Promise((resolve) => {
    Firebird.attach(options, (connectionError, database) => {
      if (connectionError) {
        console.error("Erro ao conectar no Firebird:", connectionError);
        response.status(503).json({
          autorizado: false,
          message: "Não foi possível conectar ao ERP neste momento.",
        });
        return resolve();
      }

      const sql = `
        SELECT
          IDFUNCIONARIO AS ID_FUNCIONARIO,
          NOMEFUNCIONARIO AS NOME_FUNCIONARIO,
          IDFILIAL AS ID_FILIAL
        FROM FUNCIONARIO
        WHERE LOGIN = ?
          AND SENHAWEB = ?
          AND STATUS = 'A'
      `;

      database.query(sql, [usuario, senhaHash], (queryError, result) => {
        database.detach();

        if (queryError) {
          console.error("Erro ao consultar usuário no Firebird:", queryError);
          response.status(500).json({
            autorizado: false,
            message: "Não foi possível validar o usuário no ERP.",
          });
          return resolve();
        }

        const idfilial = normalizeBranchId(result?.[0]?.ID_FILIAL);

        if (!result?.length || !idfilial) {
          response.status(401).json({
            autorizado: false,
            message: result?.length
              ? "O usuário não possui uma filial válida vinculada."
              : "Usuário ou senha inválidos.",
          });
          return resolve();
        }

        response.status(200).json({
          autorizado: true,
          idfuncionario: result[0].ID_FUNCIONARIO,
          nomefuncionario: result[0].NOME_FUNCIONARIO,
          idfilial,
        });
        return resolve();
      });
    });
  });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBranchId(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{2}$/.test(code) ? code : "";
}
