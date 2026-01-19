const { createClient } = require("redis");

class RedisConfig {

    constructor() {
        this.client = createClient({
            // url: process.env.REDIS_URL,
            username: process.env.REDIS_USERNAME,
            password: process.env.REDIS_PASSWORD,
            socket: {
                host: process.env.REDIS_HOST,
                port: parseInt(process.env.REDIS_PORT, 10),
                reconnectStrategy: (retries) => {
                    console.warn(`Redis reconnect attempt #${retries}`);
                    return Math.min(retries * 100, 3000); // delay capped at 3s
                },
                keepAlive: 10000,
            },
        });
    }


    async connect() {
        if (!this.client.isOpen) {
            try {
                await this.client.connect();
                console.log('-'.repeat(50));
                console.log("Redis connected successfully");
            } catch (err) {
                console.error("Redis connection failed:", err);
            }
        }
    }

    async disconnect() {
        try {
            await this.client.quit();
            console.log("Redis disconnected gracefully");
        } catch (err) {
            console.error("Redis disconnect error:", err.message);
        }
    }


    /**
     * Set a value in Redis with optional expiration
     * @param {string} key - The key to set
     * @param {any} value - The value to set
     * @param {number} [expiry=null] - The expiration time in seconds (if null, uses REDIS_EXPIRY from env)
     * @returns {Promise<void>}
     */
    async set(key, value, expiry = null) {
        const expiryTime = expiry !== null
            ? expiry
            : parseInt(process.env.REDIS_EXPIRY, 10) || 86400; // Default: 24 hours (86400 seconds)

        try {
            const stringValue = typeof value === "object" ? JSON.stringify(value) : value;
            await this.client.setEx(key, expiryTime, stringValue);
            console.log(`Redis SET success for key "${key}" with expiry ${expiryTime}s`);
        } catch (err) {
            console.error(`Redis SET error for key "${key}":`, err.message);
        }
    }

    /**
     * Get a value from Redis
     * @param {string} key - The key to get
     * @returns {Promise<any | null>}
     */
    async get(key) {
        try {
            const value = await this.client.get(key);
            if (!value) return null;
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        } catch (err) {
            console.error(`Redis GET error for key "${key}":`, err.message);
            return null;
        }
    }

    /**
     * Delete a value from Redis
     * @param {string} key - The key to delete
     * @returns {Promise<void>}
     */
    async del(key) {
        try {
            await this.client.del(key);
        } catch (err) {
            console.error(`Redis DEL error for key "${key}":`, err.message);
        }
    }

    /**
     * Check if a key exists in Redis
     * @param {string} key - The key to check
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (err) {
            console.error(`Redis EXISTS error for key "${key}":`, err.message);
            return false;
        }
    }
}

const redisConfig = new RedisConfig();
const connectRedis = async () => await redisConfig.connect();
module.exports = { connectRedis, redisConfig };