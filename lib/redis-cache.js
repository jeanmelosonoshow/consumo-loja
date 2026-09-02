import crypto from "crypto";

const DEFAULT_CACHE_TTL_SECONDS = 10 * 60;
const CACHE_PREFIX = "consumo-loja";

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;
  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

export function cacheTtlSeconds() {
  const configured = Number(process.env.FIREBIRD_CACHE_TTL_SECONDS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_CACHE_TTL_SECONDS;
}

export function createCacheKey(scope, payload) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return `${CACHE_PREFIX}:${scope}:${hash}`;
}

export async function getJsonCache(key) {
  const config = getRedisConfig();
  if (!config) return null;

  try {
    const response = await redisCommand(config, ["GET", key]);
    if (response.result == null) return null;
    return JSON.parse(response.result);
  } catch (error) {
    console.error("Falha ao ler cache Redis:", error);
    return null;
  }
}

export async function setJsonCache(key, value, ttlSeconds = cacheTtlSeconds()) {
  const config = getRedisConfig();
  if (!config) return false;

  try {
    await redisCommand(config, [
      "SET",
      key,
      JSON.stringify(value),
      "EX",
      String(ttlSeconds),
    ]);
    return true;
  } catch (error) {
    console.error("Falha ao gravar cache Redis:", error);
    return false;
  }
}

async function redisCommand(config, command) {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Redis respondeu com status ${response.status}`);
  }

  return response.json();
}
