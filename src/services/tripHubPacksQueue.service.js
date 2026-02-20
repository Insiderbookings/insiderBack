import bullmq from "bullmq";
import Redis from "ioredis";
import { Op } from "sequelize";
import models from "../models/index.js";
import { buildTripHubContext } from "./tripHubContext.service.js";
import {
  resolveTripHubZone,
  resolveTripHubTimeBucket,
  getTripHubPackKeys,
  generateBasePack,
  generateDeltaPack,
  getBasePackCache,
  getDeltaPackCache,
  setBasePackCache,
  setDeltaPackCache,
} from "./tripHubPacks.service.js";

const QUEUE_NAME = "triphub-packs";
const TRIP_HUB_PACKS_ENABLED = String(process.env.TRIP_HUB_PACKS_ENABLED || "true").toLowerCase() !== "false";
const TRIP_HUB_QUEUE_ENABLED = String(process.env.TRIP_HUB_QUEUE_ENABLED || "true").toLowerCase() !== "false";
const TRIP_HUB_QUEUE_CONCURRENCY = Number(process.env.TRIP_HUB_QUEUE_CONCURRENCY || 4);

let redisConnection = null;
let queue = null;
let scheduler = null;
let worker = null;
const { Queue, Worker, QueueScheduler } = bullmq;

const isRedisConfigured = () => Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

const getRedisConnection = () => {
  if (!isRedisConfigured()) return null;
  if (redisConnection) return redisConnection;
  if (process.env.REDIS_URL) {
    redisConnection = new Redis(process.env.REDIS_URL);
  } else {
    redisConnection = new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    });
  }
  return redisConnection;
};

const getQueue = () => {
  if (queue) return queue;
  const connection = getRedisConnection();
  if (!connection) return null;
  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 50,
    },
  });
  return queue;
};

const ensureQueueScheduler = () => {
  if (scheduler) return scheduler;
  const connection = getRedisConnection();
  if (!connection) return null;
  scheduler = new QueueScheduler(QUEUE_NAME, { connection });
  return scheduler;
};

const buildJobId = (prefix, parts) => `${prefix}:${parts.join(":")}`;

const generateAndCacheBase = async ({ h3, dateKey, location, force = false } = {}) => {
  if (!h3 || !dateKey || !location) return null;
  const { baseKey } = getTripHubPackKeys({ h3, dateKey, bucket: "base" });
  if (!force) {
    const cached = await getBasePackCache(baseKey);
    if (cached) return { cached: true, key: baseKey };
  }
  const pack = await generateBasePack({ location, h3, dateKey });
  if (pack) {
    await setBasePackCache(baseKey, pack);
    return { cached: false, key: baseKey };
  }
  return null;
};

const generateAndCacheDelta = async ({
  h3,
  dateKey,
  bucket,
  location,
  timeZone,
  force = false,
} = {}) => {
  if (!h3 || !dateKey || !bucket || !location) return null;
  const { deltaKey } = getTripHubPackKeys({ h3, dateKey, bucket });
  if (!force) {
    const cached = await getDeltaPackCache(deltaKey);
    if (cached) return { cached: true, key: deltaKey };
  }
  const pack = await generateDeltaPack({ location, h3, dateKey, bucket, timeZone });
  if (pack) {
    await setDeltaPackCache(deltaKey, pack);
    return { cached: false, key: deltaKey };
  }
  return null;
};

export const enqueueTripHubEnsure = async ({ tripContext, timeZone, force = false } = {}) => {
  if (!TRIP_HUB_PACKS_ENABLED) return null;
  const location = tripContext?.location || null;
  const { h3, coords } = resolveTripHubZone({ location });
  if (!h3 || !coords) return null;
  const { dateKey, bucket } = resolveTripHubTimeBucket({ timeZone });

  if (!TRIP_HUB_QUEUE_ENABLED || !isRedisConfigured()) {
    const baseResult = await generateAndCacheBase({ h3, dateKey, location: coords, force });
    const deltaResult = await generateAndCacheDelta({
      h3,
      dateKey,
      bucket,
      location: coords,
      timeZone,
      force,
    });
    return { baseResult, deltaResult, queued: false };
  }

  const queueInstance = getQueue();
  if (!queueInstance) return null;

  await queueInstance.add(
    "base-generate",
    { h3, dateKey, location: coords, force },
    { jobId: buildJobId("base", [h3, dateKey]) }
  );
  await queueInstance.add(
    "delta-generate",
    { h3, dateKey, bucket, location: coords, timeZone, force },
    { jobId: buildJobId("delta", [h3, dateKey, bucket]) }
  );

  return { queued: true, h3, dateKey, bucket };
};

export const startTripHubPackWorker = () => {
  if (!TRIP_HUB_PACKS_ENABLED) {
    console.log("[tripHub-packs] worker disabled by TRIP_HUB_PACKS_ENABLED");
    return null;
  }
  if (!TRIP_HUB_QUEUE_ENABLED || !isRedisConfigured()) {
    console.log("[tripHub-packs] worker disabled (queue/redis not configured)");
    return null;
  }
  if (worker) return worker;

  const connection = getRedisConnection();
  if (!connection) return null;

  ensureQueueScheduler();
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const payload = job.data || {};
      if (job.name === "base-generate") {
        return generateAndCacheBase(payload);
      }
      if (job.name === "delta-generate") {
        return generateAndCacheDelta(payload);
      }
      if (job.name === "ensure") {
        const { h3, dateKey, bucket, location, timeZone, force } = payload;
        const baseResult = await generateAndCacheBase({ h3, dateKey, location, force });
        const deltaResult = await generateAndCacheDelta({
          h3,
          dateKey,
          bucket,
          location,
          timeZone,
          force,
        });
        return { baseResult, deltaResult };
      }
      return null;
    },
    { connection, concurrency: TRIP_HUB_QUEUE_CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    console.warn("[tripHub-packs] job failed", job?.id, err?.message || err);
  });
  worker.on("error", (err) => {
    console.error("[tripHub-packs] worker error", err?.message || err);
  });

  console.log("[tripHub-packs] worker started", { concurrency: TRIP_HUB_QUEUE_CONCURRENCY });
  return worker;
};

const listActiveTripHubZones = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const stays = await models.Stay.findAll({
    where: {
      active: true,
      status: { [Op.notIn]: ["CANCELLED", "COMPLETED"] },
      check_in: { [Op.lte]: today },
      check_out: { [Op.gte]: today },
    },
    include: [
      {
        model: models.StayHotel,
        as: "hotelStay",
        required: false,
        include: [
          {
            model: models.Hotel,
            as: "hotel",
            attributes: ["id", "name", "city", "country", "image", "lat", "lng", "address"],
          },
          {
            model: models.WebbedsHotel,
            as: "webbedsHotel",
            attributes: ["hotel_id", "name", "city_name", "country_name", "address", "lat", "lng"],
          },
        ],
      },
      {
        model: models.StayHome,
        as: "homeStay",
        required: false,
        include: [
                    {
                        model: models.Home,
                        as: "home",
                        attributes: ["id", "title", "host_id"],
                        include: [
                            {
                                model: models.HomeAddress,
                                as: "address",
                attributes: ["city", "state", "country", "latitude", "longitude", "address_line1"],
              },
            ],
          },
        ],
      },
    ],
    limit: Number(process.env.TRIP_HUB_ACTIVE_STAYS_LIMIT || 5000),
  });

  const zoneMap = new Map();
  for (const booking of stays) {
    const context = buildTripHubContext({ booking, intelligence: null });
    const tripContext = context?.tripContext || null;
    const location = tripContext?.location || null;
    const { h3, coords } = resolveTripHubZone({ location });
    if (!h3 || !coords) continue;
    if (!zoneMap.has(h3)) {
      zoneMap.set(h3, {
        h3,
        coords,
        timeZone: context?.derived?.timeZone || null,
      });
    }
  }
  return Array.from(zoneMap.values());
};

export const runTripHubBaseRefreshSweep = async () => {
  if (!TRIP_HUB_PACKS_ENABLED) {
    return { skipped: true, reason: "TRIP_HUB_PACKS_ENABLED=false" };
  }

  const zones = await listActiveTripHubZones();
  if (!zones.length) return { skipped: false, zones: 0, queued: 0, generated: 0 };

  const { dateKey } = resolveTripHubTimeBucket();
  if (!TRIP_HUB_QUEUE_ENABLED || !isRedisConfigured()) {
    await Promise.all(
      zones.map((zone) =>
        generateAndCacheBase({
          h3: zone.h3,
          dateKey,
          location: zone.coords,
        })
      )
    );
    return { skipped: false, zones: zones.length, queued: 0, generated: zones.length };
  }

  const queueInstance = getQueue();
  if (!queueInstance) return { skipped: false, zones: zones.length, queued: 0, generated: 0 };

  await Promise.all(
    zones.map((zone) =>
      queueInstance.add(
        "base-generate",
        { h3: zone.h3, dateKey, location: zone.coords },
        { jobId: buildJobId("base", [zone.h3, dateKey]) }
      )
    )
  );

  return { skipped: false, zones: zones.length, queued: zones.length, generated: 0 };
};

export const runTripHubDeltaRefreshSweep = async () => {
  if (!TRIP_HUB_PACKS_ENABLED) {
    return { skipped: true, reason: "TRIP_HUB_PACKS_ENABLED=false" };
  }

  const zones = await listActiveTripHubZones();
  if (!zones.length) return { skipped: false, zones: 0, queued: 0, generated: 0 };

  if (!TRIP_HUB_QUEUE_ENABLED || !isRedisConfigured()) {
    await Promise.all(
      zones.map(async (zone) => {
        const { dateKey, bucket } = resolveTripHubTimeBucket({ timeZone: zone.timeZone });
        return generateAndCacheDelta({
          h3: zone.h3,
          dateKey,
          bucket,
          location: zone.coords,
          timeZone: zone.timeZone,
        });
      })
    );
    return { skipped: false, zones: zones.length, queued: 0, generated: zones.length };
  }

  const queueInstance = getQueue();
  if (!queueInstance) return { skipped: false, zones: zones.length, queued: 0, generated: 0 };

  await Promise.all(
    zones.map(async (zone) => {
      const { dateKey, bucket } = resolveTripHubTimeBucket({ timeZone: zone.timeZone });
      return queueInstance.add(
        "delta-generate",
        {
          h3: zone.h3,
          dateKey,
          bucket,
          location: zone.coords,
          timeZone: zone.timeZone,
        },
        { jobId: buildJobId("delta", [zone.h3, dateKey, bucket]) }
      );
    })
  );

  return { skipped: false, zones: zones.length, queued: zones.length, generated: 0 };
};
