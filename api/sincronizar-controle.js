import { neon } from "@neondatabase/serverless";
import {
  findCompletedReadingDates,
  syncCompletedDatesToFirebird,
} from "../lib/controle-consumo.js";

const CODIGO_FILIAL_VALIDO = /^[A-Z0-9]{2}$/;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ message: "Método não permitido." });
  }

  const filial = String(request.body?.IDFILIAL_USR ?? "").trim().toUpperCase();
  if (!CODIGO_FILIAL_VALIDO.test(filial)) {
    return response.status(400).json({ message: "Código da filial inválido." });
  }

  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    return response.status(500).json({
      message: "A conexão com o banco de dados não está configurada.",
    });
  }

  try {
    const sql = neon(connectionString);
    const completedDates = await findCompletedReadingDates(sql, filial);
    const synchronized = await syncCompletedDatesToFirebird(
      filial,
      completedDates,
    );

    return response.status(200).json({
      message: `${synchronized.length} dia(s) completo(s) sincronizado(s) com o Firebird.`,
      filial,
      datas: synchronized,
    });
  } catch (error) {
    console.error("Erro ao sincronizar controle de consumo:", error);
    return response.status(error.statusCode ?? 500).json({
      message:
        error.statusCode === 503
          ? error.message
          : "Não foi possível sincronizar o controle de consumo no Firebird.",
    });
  }
}
