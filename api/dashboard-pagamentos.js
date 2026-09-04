import {
  getDashboardAccess,
  selectAuthorizedBranches,
} from "../lib/dashboard-access.js";
import { getDashboardPayments } from "../lib/dashboard-payments.js";

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
    const branches = selectAuthorizedBranches(access, request.query.filiais);
    const payments = await getDashboardPayments(branches);
    const selectedMetadata = access.filiais
      .filter((branch) => branches.includes(branch.codigo))
      .map((branch) => {
        const payment = payments.find((item) => item.filial === branch.codigo);
        return payment
          ? {
              codigo: payment.filial,
              nome: payment.nomeFilial,
              cidade: payment.cidade,
              uf: payment.uf,
            }
          : branch;
      });

    return response.status(200).json({
      filial: selectedMetadata.length === 1 ? selectedMetadata[0] : null,
      filiais: selectedMetadata,
      pagamentos: payments,
    });
  } catch (error) {
    console.error("Erro na consulta de pagamentos:", error);
    return response.status(error.statusCode ?? 500).json({
      message: error.statusCode
        ? error.message
        : "Não foi possível consultar os pagamentos no ERP.",
    });
  }
}
