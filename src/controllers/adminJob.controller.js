import models from "../models/index.js";
import { reloadScheduledJobs, runJobNow, validateCronExpression } from "../services/jobScheduler.service.js";

const normalizeJobName = (value) => String(value || "").trim().toLowerCase();

const serializeJob = (row) => ({
  name: row.name,
  enabled: Boolean(row.enabled),
  cronExpression: row.cronExpression ?? row.cron_expression ?? null,
  timezone: row.timezone ?? null,
  lastRunAt: row.lastRunAt ?? row.last_run_at ?? null,
  lastStatus: row.lastStatus ?? row.last_status ?? null,
  lastError: row.lastError ?? row.last_error ?? null,
  nextRunAt: row.nextRunAt ?? row.next_run_at ?? null,
  updatedBy: row.updatedBy ?? row.updated_by ?? null,
  createdAt: row.createdAt ?? row.created_at ?? null,
  updatedAt: row.updatedAt ?? row.updated_at ?? null,
});

const serializeJobRun = (row) => ({
  id: row.id,
  jobName: row.jobName ?? row.job_name ?? null,
  source: row.source ?? null,
  status: row.status ?? null,
  startedAt: row.startedAt ?? row.started_at ?? null,
  finishedAt: row.finishedAt ?? row.finished_at ?? null,
  triggeredBy: row.triggeredBy ?? row.triggered_by ?? null,
  errorMessage: row.errorMessage ?? row.error_message ?? null,
  createdAt: row.createdAt ?? row.created_at ?? null,
  updatedAt: row.updatedAt ?? row.updated_at ?? null,
});

export const adminListJobs = async (req, res) => {
  try {
    const rows = await models.ScheduledJob.findAll({
      order: [["name", "ASC"]],
    });
    return res.json({ jobs: rows.map(serializeJob) });
  } catch (error) {
    console.error("[admin.jobs] list error", error);
    return res.status(500).json({ error: "Failed to load scheduled jobs" });
  }
};

export const adminUpdateJob = async (req, res) => {
  try {
    const name = normalizeJobName(req.params.name);
    if (!name) return res.status(400).json({ error: "Job name is required" });

    const updates = {};
    if (req.body?.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
    if (req.body?.cronExpression !== undefined) {
      const value = String(req.body.cronExpression || "").trim();
      if (value && !validateCronExpression(value)) {
        return res.status(400).json({ error: "Invalid cron expression" });
      }
      updates.cronExpression = value || null;
    }
    if (req.body?.timezone !== undefined) {
      const value = String(req.body.timezone || "").trim();
      updates.timezone = value || null;
    }
    updates.updatedBy = req.user?.id || null;

    const [job] = await models.ScheduledJob.findOrCreate({
      where: { name },
      defaults: {
        name,
        enabled: true,
      },
    });

    await job.update(updates);
    await reloadScheduledJobs({ reason: `admin-update:${name}` });
    return res.json({ job: serializeJob(job) });
  } catch (error) {
    console.error("[admin.jobs] update error", error);
    return res.status(500).json({ error: "Failed to update scheduled job" });
  }
};

export const adminRunJob = async (req, res) => {
  try {
    const name = normalizeJobName(req.params.name);
    if (!name) return res.status(400).json({ error: "Job name is required" });

    const job = await models.ScheduledJob.findByPk(name);
    if (!job) return res.status(404).json({ error: "Scheduled job not found" });

    const result = await runJobNow(name, {
      source: "manual",
      triggeredBy: req.user?.id || null,
    });

    const refreshed = await models.ScheduledJob.findByPk(name);

    return res.status(202).json({
      message: result?.skipped ? "Job is already running" : "Job executed manually",
      job: refreshed ? serializeJob(refreshed) : serializeJob(job),
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("No handler configured")) {
      return res.status(400).json({ error: message });
    }
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    console.error("[admin.jobs] run error", error);
    return res.status(500).json({ error: "Failed to execute scheduled job" });
  }
};

export const adminListJobRuns = async (req, res) => {
  try {
    const name = normalizeJobName(req.params.name);
    if (!name) return res.status(400).json({ error: "Job name is required" });

    const limitRaw = Number(req.query?.limit ?? 20);
    const pageRaw = Number(req.query?.page ?? 1);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 20));
    const page = Math.max(1, Number.isFinite(pageRaw) ? Math.trunc(pageRaw) : 1);
    const offset = (page - 1) * limit;

    const result = await models.ScheduledJobRun.findAndCountAll({
      where: { jobName: name },
      order: [["startedAt", "DESC"]],
      limit,
      offset,
    });

    const total = Number(result?.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      runs: (result?.rows || []).map(serializeJobRun),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    });
  } catch (error) {
    console.error("[admin.jobs] list runs error", error);
    return res.status(500).json({ error: "Failed to load job runs" });
  }
};
