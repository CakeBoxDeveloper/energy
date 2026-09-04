const { Redis } = require('@upstash/redis');
const config = require('../config');

let redisClient = null;
const memoryStore = new Map();

function getRedis() {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (url && token) {
    redisClient = new Redis({ url, token });
    return redisClient;
  }

  return null;
}

/**
 * Save user tokens/data in Redis
 * @param {string|number} userId Telegram User ID
 * @param {string} service 'google' | 'fatsecret'
 * @param {object} data Token data
 */
async function setUserServiceData(userId, service, data) {
  const redis = getRedis();
  const key = `user:${userId}:${service}`;

  if (redis) {
    await redis.set(key, JSON.stringify(data));
  } else {
    memoryStore.set(key, JSON.stringify(data));
  }
}

/**
 * Get user tokens/data from Redis
 * @param {string|number} userId Telegram User ID
 * @param {string} service 'google' | 'fatsecret'
 * @returns {Promise<object|null>}
 */
async function getUserServiceData(userId, service) {
  const redis = getRedis();
  const key = `user:${userId}:${service}`;

  let raw = null;
  if (redis) {
    raw = await redis.get(key);
  } else {
    raw = memoryStore.get(key);
  }

  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Delete user tokens from Redis
 * @param {string|number} userId Telegram User ID
 * @param {string} service 'google' | 'fatsecret' | 'all'
 */
async function deleteUserServiceData(userId, service = 'all') {
  const redis = getRedis();
  const services = service === 'all' ? ['google', 'fatsecret'] : [service];

  for (const s of services) {
    const key = `user:${userId}:${s}`;
    if (redis) {
      await redis.del(key);
    } else {
      memoryStore.delete(key);
    }
  }
}

/**
 * Get last bot message ID for a user
 */
async function getLastMessageId(userId) {
  const redis = getRedis();
  const key = `user:${userId}:last_msg_id`;
  if (redis) {
    return await redis.get(key);
  }
  return memoryStore.get(key) || null;
}

/**
 * Set last bot message ID for a user
 */
async function setLastMessageId(userId, messageId) {
  const redis = getRedis();
  const key = `user:${userId}:last_msg_id`;
  if (redis) {
    await redis.set(key, messageId);
  } else {
    memoryStore.set(key, messageId);
  }
}

module.exports = {
  getRedis,
  setUserServiceData,
  getUserServiceData,
  deleteUserServiceData,
  getLastMessageId,
  setLastMessageId,
};
