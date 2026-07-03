import { createRequire } from "module";
import crypto from "crypto";
import { createAdminToken, handleAdminError, isAdminEmployee } from "../lib/admin-auth.js";

const require = createRequire(import.meta.url);
const Firebird = require("node-firebird");
const FIREBIRD_LOGIN_TIMEOUT_MS = 12000;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ message: "Método não permitido." });
  }

  try {
    const usuario = normalizeText(request.body?.usuario);
    const senha = normalizeText(request.body?.senha);

    if (!usuario || !senha) {
      return response.status(400).json({ message: "Informe o usuário e a senha." });
    }

    const missingVariable = [
      "DB_HOST_FB",
      "DB_PORT_FB",
      "DB_PATH_FB",
      "DB_USER_FB",
      "DB_PASSWORD_FB",
    ].find((name) => !process.env[name]);

    if (missingVariable) {
      return response.status(500).json({
        message: "A conexão com o ERP não está configurada neste projeto.",
      });
    }

    const user = await withTimeout(
      findFirebirdUser(usuario, senha),
      FIREBIRD_LOGIN_TIMEOUT_MS,
      "O ERP demorou para responder à validação do login. Tente novamente em alguns instantes.",
    );

    if (!user) {
      return response.status(401).json({ message: "Usuário ou senha inválidos." });
    }

    if (!isAdminEmployee(user.idfuncionario)) {
      return response.status(403).json({
        message: "Seu funcionário não possui permissão para acessar o admin.",
      });
    }

    return response.status(200).json({
      autorizado: true,
      token: createAdminToken(user),
      idfuncionario: user.idfuncionario,
      nomefuncionario: user.nomefuncionario,
    });
  } catch (error) {
    return handleAdminError(error, response);
  }
}

function findFirebirdUser(usuario, senha) {
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

  return new Promise((resolve, reject) => {
    Firebird.attach(options, (connectionError, database) => {
      if (connectionError) return reject(connectionError);

      const sql = `
        SELECT
          IDFUNCIONARIO AS ID_FUNCIONARIO,
          NOMEFUNCIONARIO AS NOME_FUNCIONARIO
        FROM FUNCIONARIO
        WHERE LOGIN = ?
          AND SENHAWEB = ?
          AND STATUS = 'A'
      `;

      database.query(sql, [usuario, senhaHash], (queryError, result) => {
        database.detach();
        if (queryError) return reject(queryError);
        if (!result?.length) return resolve(null);
        return resolve({
          idfuncionario: result[0].ID_FUNCIONARIO,
          nomefuncionario: result[0].NOME_FUNCIONARIO,
        });
      });
    });
  });
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      error.statusCode = 503;
      reject(error);
    }, milliseconds);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
