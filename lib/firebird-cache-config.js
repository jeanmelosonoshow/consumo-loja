import { readFileSync } from "fs";

const DEFAULT_CONFIG = {
  connectionMode: "direct",
  cacheTtlSeconds: 60 * 60,
  staleCacheTtlSeconds: 24 * 60 * 60,
  redisTimeoutMs: 1500,
  cachePrefix: "consumo-loja",
};

const CONFIG_PATH = new URL("../config/firebird-cache.json", import.meta.url);
let cachedConfig = null;

export function getFirebirdCacheConfig() {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }

  return {
    ...cachedConfig,
    connectionMode: normalizeConnectionMode(
      process.env.FIREBIRD_CONNECTION_MODE ?? cachedConfig.connectionMode,
    ),
    cacheTtlSeconds: positiveInteger(
      process.env.FIREBIRD_CACHE_TTL_SECONDS,
      cachedConfig.cacheTtlSeconds,
    ),
    staleCacheTtlSeconds: positiveInteger(
      process.env.FIREBIRD_STALE_CACHE_TTL_SECONDS,
      cachedConfig.staleCacheTtlSeconds,
    ),
    redisTimeoutMs: positiveInteger(
      process.env.REDIS_CACHE_TIMEOUT_MS,
      cachedConfig.redisTimeoutMs,
    ),
    cachePrefix: process.env.REDIS_CACHE_PREFIX ?? cachedConfig.cachePrefix,
  };
}

export function canUseDirectFirebird() {
  return getFirebirdCacheConfig().connectionMode === "direct";
}

function loadConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      connectionMode: normalizeConnectionMode(parsed.connectionMode),
      cacheTtlSeconds: positiveInteger(
        parsed.cacheTtlSeconds,
        DEFAULT_CONFIG.cacheTtlSeconds,
      ),
      staleCacheTtlSeconds: positiveInteger(
        parsed.staleCacheTtlSeconds,
        DEFAULT_CONFIG.staleCacheTtlSeconds,
      ),
      redisTimeoutMs: positiveInteger(
        parsed.redisTimeoutMs,
        DEFAULT_CONFIG.redisTimeoutMs,
      ),
      cachePrefix: typeof parsed.cachePrefix === "string" && parsed.cachePrefix.trim()
        ? parsed.cachePrefix.trim()
        : DEFAULT_CONFIG.cachePrefix,
    };
  } catch (error) {
    console.error("Falha ao ler config/firebird-cache.json:", error);
    return DEFAULT_CONFIG;
  }
}

function normalizeConnectionMode(value) {
  return value === "redis-only" ? "redis-only" : "direct";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
