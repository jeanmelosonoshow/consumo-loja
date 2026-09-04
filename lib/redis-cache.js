import crypto from "crypto";
import { getFirebirdCacheConfig } from "./firebird-cache-config.js";

const CACHE_LOCK_SECONDS = 20;

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
  return getFirebirdCacheConfig().cacheTtlSeconds;
}

export function staleCacheTtlSeconds() {
  return getFirebirdCacheConfig().staleCacheTtlSeconds;
}

function redisTimeoutMs() {
  return getFirebirdCacheConfig().redisTimeoutMs;
}

export function createCacheKey(scope, payload) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return `${getFirebirdCacheConfig().cachePrefix}:${scope}:${hash}`;
}

export async function getJsonCache(key) {
  const entry = await getJsonCacheEntry(key);
  return entry.hit ? entry.value : null;
}

export async function getJsonCacheEntry(key) {
  const config = getRedisConfig();
  if (!config) return { hit: false, value: null };

  try {
    const response = await redisCommand(config, ["GET", key]);
    if (response.result == null) return { hit: false, value: null };
    return { hit: true, value: JSON.parse(response.result) };
  } catch (error) {
    console.error("Falha ao ler cache Redis:", error);
    return { hit: false, value: null };
  }
}

export async function getStaleJsonCache(key) {
  return getJsonCacheEntry(staleKey(key));
}

export async function setJsonCache(key, value, options = {}) {
  const config = getRedisConfig();
  if (!config) return false;

  const ttlSeconds = typeof options === "number"
    ? options
    : options.ttlSeconds ?? cacheTtlSeconds();
  const staleTtlSecondsValue = typeof options === "number"
    ? staleCacheTtlSeconds()
    : options.staleTtlSeconds ?? staleCacheTtlSeconds();

  try {
    const serialized = JSON.stringify(value);
    await redisCommand(config, [
      "SET",
      key,
      serialized,
      "EX",
      String(ttlSeconds),
    ]);

    if (staleTtlSecondsValue > ttlSeconds) {
      await redisCommand(config, [
        "SET",
        staleKey(key),
        serialized,
        "EX",
        String(staleTtlSecondsValue),
      ]);
    }

    return true;
  } catch (error) {
    console.error("Falha ao gravar cache Redis:", error);
    return false;
  }
}

export async function acquireCacheLock(key) {
  const config = getRedisConfig();
  if (!config) return { acquired: false, token: null };

  const lockKey = createLockKey(key);
  const token = crypto.randomUUID();

  try {
    const response = await redisCommand(config, [
      "SET",
      lockKey,
      token,
      "NX",
      "EX",
      String(CACHE_LOCK_SECONDS),
    ]);

    return { acquired: response.result === "OK", token };
  } catch (error) {
    console.error("Falha ao criar trava de cache Redis:", error);
    return { acquired: false, token: null };
  }
}

export async function releaseCacheLock(key, token) {
  const config = getRedisConfig();
  if (!config || !token) return false;

  try {
    const response = await redisCommand(config, [
      "EVAL",
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      "1",
      createLockKey(key),
      token,
    ]);

    return Number(response.result) === 1;
  } catch (error) {
    console.error("Falha ao liberar trava de cache Redis:", error);
    return false;
  }
}

export async function waitForJsonCache(key, attempts = 10, delayMs = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(delayMs);
    const cached = await getJsonCacheEntry(key);
    if (cached.hit) return cached;
  }

  return { hit: false, value: null };
}

async function redisCommand(config, command) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), redisTimeoutMs());

  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Redis respondeu com status ${response.status}`);
  }

  return response.json();
}

function createLockKey(key) {
  return `${key}:lock`;
}

function staleKey(key) {
  return `${key}:stale`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
