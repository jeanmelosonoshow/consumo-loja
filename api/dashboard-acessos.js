import { getDashboardAccess } from "./_dashboard-access.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ message: "Método não permitido." });
  }

  try {
    const access = await getDashboardAccess(
      request.query.filial,
      request.query.funcionario,
    );
    return response.status(200).json(access);
  } catch (error) {
    console.error("Erro ao consultar acessos do dashboard:", error);
    return response.status(error.statusCode ?? 500).json({
      message: error.statusCode
        ? error.message
        : "Não foi possível consultar os acessos do dashboard.",
    });
  }
}
