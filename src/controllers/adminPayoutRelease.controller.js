import crypto from "crypto";
import models from "../models/index.js";
import {
  normalizePayoutBatchLimit,
  previewPayoutBatch,
  processPayoutBatch,
  resolvePayoutCutoffDate,
} from "./payout.controller.js";

const DEFAULT_PREVIEW_LIMIT = 100;
const DEFAULT_APPROVAL_TTL_MINUTES = 240;

const resolveApprovalTtlMinutes = () => {
  const raw = Number(process.env.PAYOUT_RELEASE_APPROVAL_TTL_MINUTES || DEFAULT_APPROVAL_TTL_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_APPROVAL_TTL_MINUTES;
  return Math.max(5, Math.min(7 * 24 * 60, Math.trunc(raw)));
};

const normalizeId = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

const normalizeNotes = (value, maxLength = 2000) => {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLength);
};

const buildSnapshotHash = (snapshot) => {
  const serialized = JSON.stringify(snapshot || {});
  return crypto.createHash("sha256").update(serialized).digest("hex");
};

const serializeRelease = (row, { includeSnapshot = false } = {}) => {
  const release = row?.toJSON ? row.toJSON() : row || {};
  return {
    id: release.id,
    status: release.status,
    cutoffDate: release.cutoff_date ?? release.cutoffDate ?? null,
    limit: release.batch_limit ?? release.batchLimit ?? null,
    previewSummary: release.preview_summary ?? release.previewSummary ?? null,
    snapshotHash: release.snapshot_hash ?? release.snapshotHash ?? null,
    preparedBy: release.prepared_by ?? release.preparedBy ?? null,
    approvedBy: release.approved_by ?? release.approvedBy ?? null,
    approvedAt: release.approved_at ?? release.approvedAt ?? null,
    expiresAt: release.expires_at ?? release.expiresAt ?? null,
    executedBy: release.executed_by ?? release.executedBy ?? null,
    executedAt: release.executed_at ?? release.executedAt ?? null,
    payoutBatchId: release.payout_batch_id ?? release.payoutBatchId ?? null,
    runResult: release.run_result ?? release.runResult ?? null,
    notes: release.notes ?? null,
    createdAt: release.created_at ?? release.createdAt ?? null,
    updatedAt: release.updated_at ?? release.updatedAt ?? null,
    previewSnapshot: includeSnapshot ? release.preview_snapshot ?? release.previewSnapshot ?? null : undefined,
  };
};

const resolvePreviewParams = (req) => {
  const rawLimit = req.body?.limit ?? req.query?.limit ?? DEFAULT_PREVIEW_LIMIT;
  const limit = normalizePayoutBatchLimit(rawLimit, DEFAULT_PREVIEW_LIMIT, 1000);
  const cutoffDate = resolvePayoutCutoffDate(req.body?.cutoffDate ?? req.query?.cutoffDate);
  return { limit, cutoffDate };
};

export const adminPreviewPayoutBatch = async (req, res) => {
  try {
    const { limit, cutoffDate } = resolvePreviewParams(req);
    const preview = await previewPayoutBatch({ limit, cutoffDate });
    const snapshot = {
      generatedAt: new Date().toISOString(),
      cutoffDate,
      limit,
      ...preview,
    };
    return res.json({
      preview: snapshot,
      snapshotHash: buildSnapshotHash(snapshot),
    });
  } catch (error) {
    if (String(error?.message || "").includes("cutoffDate")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[admin.payout-release] preview error", error);
    return res.status(500).json({ error: "Failed to generate payout preview" });
  }
};

export const adminCreatePayoutRelease = async (req, res) => {
  try {
    const userId = normalizeId(req.user?.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { limit, cutoffDate } = resolvePreviewParams(req);
    const notes = normalizeNotes(req.body?.notes);
    const preview = await previewPayoutBatch({ limit, cutoffDate });

    const snapshot = {
      generatedAt: new Date().toISOString(),
      cutoffDate,
      limit,
      ...preview,
    };
    const snapshotHash = buildSnapshotHash(snapshot);

    const release = await models.PayoutRelease.create({
      status: "DRAFT",
      cutoff_date: cutoffDate,
      batch_limit: limit,
      preview_summary: preview.summary,
      preview_snapshot: snapshot,
      snapshot_hash: snapshotHash,
      prepared_by: userId,
      notes,
    });

    return res.status(201).json({ release: serializeRelease(release, { includeSnapshot: true }) });
  } catch (error) {
    if (String(error?.message || "").includes("cutoffDate")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[admin.payout-release] create error", error);
    return res.status(500).json({ error: "Failed to create payout release draft" });
  }
};

export const adminListPayoutReleases = async (req, res) => {
  try {
    const limit = normalizePayoutBatchLimit(req.query?.limit, 20, 100);
    const pageRaw = Number(req.query?.page ?? 1);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 1;
    const offset = (page - 1) * limit;

    const result = await models.PayoutRelease.findAndCountAll({
      order: [["id", "DESC"]],
      limit,
      offset,
    });

    const total = Number(result?.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      items: (result?.rows || []).map((row) => serializeRelease(row, { includeSnapshot: false })),
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
    console.error("[admin.payout-release] list error", error);
    return res.status(500).json({ error: "Failed to load payout releases" });
  }
};

export const adminGetPayoutRelease = async (req, res) => {
  try {
    const releaseId = normalizeId(req.params.id);
    if (!releaseId) return res.status(400).json({ error: "Invalid payout release id" });

    const release = await models.PayoutRelease.findByPk(releaseId);
    if (!release) return res.status(404).json({ error: "Payout release not found" });

    return res.json({ release: serializeRelease(release, { includeSnapshot: true }) });
  } catch (error) {
    console.error("[admin.payout-release] detail error", error);
    return res.status(500).json({ error: "Failed to load payout release" });
  }
};

export const adminApprovePayoutRelease = async (req, res) => {
  try {
    const releaseId = normalizeId(req.params.id);
    if (!releaseId) return res.status(400).json({ error: "Invalid payout release id" });

    const approverId = normalizeId(req.user?.id);
    if (!approverId) return res.status(401).json({ error: "Unauthorized" });

    const release = await models.PayoutRelease.findByPk(releaseId);
    if (!release) return res.status(404).json({ error: "Payout release not found" });
    if (release.status !== "DRAFT") {
      return res.status(409).json({ error: `Only DRAFT releases can be approved (current: ${release.status})` });
    }
    if (Number(release.prepared_by) === approverId) {
      return res.status(400).json({ error: "Approval requires a different admin from the preparer" });
    }

    const readyCount = Number(release.preview_summary?.readyCount || 0);
    if (readyCount <= 0) {
      return res.status(400).json({ error: "Preview has no ready items to execute" });
    }

    const approvedAt = new Date();
    const ttlMinutes = resolveApprovalTtlMinutes();
    const expiresAt = new Date(approvedAt.getTime() + ttlMinutes * 60 * 1000);
    const notes = normalizeNotes(req.body?.notes);

    await release.update({
      status: "APPROVED",
      approved_by: approverId,
      approved_at: approvedAt,
      expires_at: expiresAt,
      notes: notes || release.notes || null,
    });

    return res.json({ release: serializeRelease(release, { includeSnapshot: false }) });
  } catch (error) {
    console.error("[admin.payout-release] approve error", error);
    return res.status(500).json({ error: "Failed to approve payout release" });
  }
};

export const adminRunPayoutRelease = async (req, res) => {
  try {
    const releaseId = normalizeId(req.params.id);
    if (!releaseId) return res.status(400).json({ error: "Invalid payout release id" });

    const executorId = normalizeId(req.user?.id);
    if (!executorId) return res.status(401).json({ error: "Unauthorized" });

    const release = await models.PayoutRelease.findByPk(releaseId);
    if (!release) return res.status(404).json({ error: "Payout release not found" });
    if (release.status !== "APPROVED") {
      return res.status(409).json({ error: `Only APPROVED releases can run (current: ${release.status})` });
    }

    if (release.expires_at) {
      const expiresAt = new Date(release.expires_at);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
        await release.update({
          status: "CANCELLED",
          run_result: {
            reason: "Approval expired before execution",
            expiredAt: expiresAt.toISOString(),
          },
        });
        return res.status(409).json({ error: "Payout release approval has expired" });
      }
    }

    const snapshot = release.preview_snapshot || {};
    const snapshotHash = buildSnapshotHash(snapshot);
    if (snapshotHash !== release.snapshot_hash) {
      await release.update({
        status: "FAILED",
        executed_by: executorId,
        executed_at: new Date(),
        run_result: {
          reason: "Snapshot hash mismatch",
          expected: release.snapshot_hash,
          got: snapshotHash,
        },
      });
      return res.status(409).json({ error: "Release snapshot integrity check failed" });
    }

    const approvedItemIds = Array.isArray(snapshot?.itemIds) ? snapshot.itemIds : [];
    if (!approvedItemIds.length) {
      return res.status(400).json({ error: "Release has no approved item ids to execute" });
    }

    await release.update({
      status: "RUNNING",
      executed_by: executorId,
      executed_at: new Date(),
    });

    try {
      const result = await processPayoutBatch({
        limit: release.batch_limit,
        cutoffDate: release.cutoff_date,
        itemIds: approvedItemIds,
      });

      await release.update({
        status: "COMPLETED",
        payout_batch_id: result?.batchId || null,
        run_result: result,
      });
    } catch (runError) {
      await release.update({
        status: "FAILED",
        run_result: {
          error: String(runError?.message || runError || "Failed to execute payout release"),
        },
      });
      throw runError;
    }

    return res.status(202).json({ release: serializeRelease(release, { includeSnapshot: false }) });
  } catch (error) {
    console.error("[admin.payout-release] run error", error);
    return res.status(500).json({ error: "Failed to run payout release" });
  }
};
