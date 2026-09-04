import { findUserByLogin } from "../lib/firebird-users.js";

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

  try {
    const user = await findUserByLogin(usuario, senha);

    if (!user?.idfilial) {
      return response.status(401).json({
        autorizado: false,
        message: user
          ? "O usuário não possui uma filial válida vinculada."
          : "Usuário ou senha inválidos.",
      });
    }

    return response.status(200).json({
      autorizado: true,
      idfuncionario: user.idfuncionario,
      nomefuncionario: user.nomefuncionario,
      idfilial: user.idfilial,
    });
  } catch (error) {
    console.error("Erro ao validar usuário:", error);
    return response.status(error.statusCode ?? 500).json({
      autorizado: false,
      message: error.statusCode
        ? error.message
        : "Não foi possível validar o usuário no ERP.",
    });
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
