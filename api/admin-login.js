import { createAdminToken, handleAdminError, isAdminEmployee } from "../lib/admin-auth.js";
import { findUserByLogin } from "../lib/firebird-users.js";

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

    const user = await findUserByLogin(usuario, senha);

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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
