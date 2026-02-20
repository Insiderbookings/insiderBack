import cron from "node-cron";
import models from "../models/index.js";
import { JOB_DEFINITIONS, JOB_HANDLERS } from "../cronjobs/index.js";

const DEFAULT_TIMEZONE = "UTC";

const TASKS = new Map();
const RUNNING_JOBS = new Set();
let started = false;
let reloading = false;
let pollTimer = null;

const toJobName = (value) => String(value || "").trim().toLowerCase();
const toErrorMessage = (error) => String(error?.message || error || "Unknown error").slice(0, 2000);
const toSource = (value, fallback = "manual") => {
  const raw = String(value || "").trim().toLowerCase();
  return raw || fallback;
};

const destroyTask = (task) => {
  if (!task) return;
  try {
    task.stop?.();
    task.destroy?.();
  } catch (error) {
    console.warn("[job-scheduler] failed to destroy task", toErrorMessage(error));
  }
};

const unscheduleAll = () => {
  TASKS.forEach((task) => destroyTask(task));
  TASKS.clear();
};

export const validateCronExpression = (value) => cron.validate(String(value || "").trim());

const ensureDefaultJobs = async () => {
  for (const row of JOB_DEFINITIONS) {
    await models.ScheduledJob.findOrCreate({
      where: { name: row.name },
      defaults: {
        name: row.name,
        enabled: row.defaults.enabled,
        cronExpression: row.defaults.cronExpression || null,
        timezone: row.defaults.timezone || DEFAULT_TIMEZONE,
      },
    });
  }
};

const scheduleRow = (row) => {
  const name = toJobName(row?.name);
  if (!name) return;
  if (!row?.enabled) return;

  const handler = JOB_HANDLERS[name];
  if (!handler) {
    console.warn("[job-scheduler] no handler registered", { name });
    return;
  }

  const cronExpression = String(row?.cronExpression || row?.cron_expression || "").trim();
  if (!cronExpression) return;
  if (!validateCronExpression(cronExpression)) {
    console.warn("[job-scheduler] invalid cron expression", { name, cronExpression });
    return;
  }

  const timezone = String(row?.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  const task = cron.schedule(
    cronExpression,
    () => {
      runJobNow(name, { source: "automatic" }).catch((error) => {
        console.error("[job-scheduler] scheduled run error", { name, error: toErrorMessage(error) });
      });
    },
    { timezone }
  );

  TASKS.set(name, task);
  console.log("[job-scheduler] scheduled", { name, cronExpression, timezone });
};

export const reloadScheduledJobs = async ({ reason = "manual" } = {}) => {
  if (reloading) return;
  reloading = true;
  try {
    const rows = await models.ScheduledJob.findAll({ order: [["name", "ASC"]] });
    unscheduleAll();
    for (const row of rows) {
      scheduleRow(row);
    }
    console.log("[job-scheduler] reload complete", { reason, jobs: rows.length, scheduled: TASKS.size });
  } finally {
    reloading = false;
  }
};

export const runJobNow = async (jobName, { source = "manual", triggeredBy = null } = {}) => {
  const name = toJobName(jobName);
  if (!name) throw new Error("Job name is required");
  const sourceValue = toSource(source);

  const job = await models.ScheduledJob.findByPk(name);
  if (!job) throw new Error("Scheduled job not found");

  const handler = JOB_HANDLERS[name];
  if (!handler) throw new Error(`No handler configured for job: ${name}`);

  if (RUNNING_JOBS.has(name)) {
    const now = new Date();
    await models.ScheduledJobRun.create({
      jobName: name,
      source: sourceValue,
      status: "SKIPPED",
      startedAt: now,
      finishedAt: now,
      triggeredBy,
      errorMessage: "Job is already running",
    });
    return {
      skipped: true,
      message: "Job is already running",
      job,
    };
  }

  RUNNING_JOBS.add(name);
  const startedAt = new Date();
  const runLog = await models.ScheduledJobRun.create({
    jobName: name,
    source: sourceValue,
    status: "RUNNING",
    startedAt,
    triggeredBy,
  });

  try {
    await handler({ job, source: sourceValue, triggeredBy });
    const finishedAt = new Date();
    await job.update({
      lastRunAt: finishedAt,
      lastStatus: "SUCCESS",
      lastError: null,
      updatedBy: triggeredBy || job.updatedBy || null,
    });
    await runLog.update({
      status: "SUCCESS",
      finishedAt,
      errorMessage: null,
    });
    return { skipped: false, job };
  } catch (error) {
    const finishedAt = new Date();
    const message = toErrorMessage(error);
    await job.update({
      lastRunAt: finishedAt,
      lastStatus: "ERROR",
      lastError: message,
      updatedBy: triggeredBy || job.updatedBy || null,
    });
    await runLog.update({
      status: "ERROR",
      finishedAt,
      errorMessage: message,
    });
    throw error;
  } finally {
    RUNNING_JOBS.delete(name);
  }
};

export const runJobFromApi = async (jobName, { source = "api:unknown", triggeredBy = null } = {}) => {
  const sourceValue = toSource(source, "api:unknown");
  return runJobNow(jobName, { source: sourceValue, triggeredBy });
};

export const startJobScheduler = async () => {
  if (started) return;
  started = true;

  await ensureDefaultJobs();
  await reloadScheduledJobs({ reason: "startup" });

  const pollMs = Number(process.env.JOB_SCHEDULER_DB_POLL_MS || 30000);
  if (Number.isFinite(pollMs) && pollMs > 0) {
    pollTimer = setInterval(() => {
      reloadScheduledJobs({ reason: "poll" }).catch((error) => {
        console.error("[job-scheduler] poll reload error", toErrorMessage(error));
      });
    }, pollMs);
    if (typeof pollTimer.unref === "function") pollTimer.unref();
    console.log("[job-scheduler] polling enabled", { pollMs });
  }
};

export default {
  startJobScheduler,
  reloadScheduledJobs,
  runJobNow,
  validateCronExpression,
};
