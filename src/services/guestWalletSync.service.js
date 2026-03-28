const DEFAULT_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 150;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeMeta = (meta) => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return { ...meta };
};

const writeWalletSyncState = async ({ booking, action, issue = null }) => {
  if (!booking?.update || !action) return;

  const meta = normalizeMeta(booking.meta);
  const walletSync = normalizeMeta(meta.walletSync);
  const issues = normalizeMeta(walletSync.issues);

  if (issue) {
    issues[action] = issue;
  } else {
    delete issues[action];
  }

  if (Object.keys(issues).length) {
    walletSync.issues = issues;
    walletSync.updatedAt = new Date().toISOString();
    meta.walletSync = walletSync;
  } else {
    delete walletSync.issues;
    if (Object.keys(walletSync).length) {
      walletSync.updatedAt = new Date().toISOString();
      meta.walletSync = walletSync;
    } else {
      delete meta.walletSync;
    }
  }

  await booking.update({ meta });
};

export const runWalletBookingMutation = async ({
  booking,
  action,
  mutation,
  retries = DEFAULT_RETRY_ATTEMPTS,
  delayMs = RETRY_DELAY_MS,
  context = null,
} = {}) => {
  if (typeof mutation !== "function") {
    throw new Error("wallet mutation handler is required");
  }

  let lastError = null;
  const attempts = Math.max(1, Number(retries) || DEFAULT_RETRY_ATTEMPTS);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await mutation();
      if (booking && action) {
        await writeWalletSyncState({ booking, action, issue: null });
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(delayMs);
      }
    }
  }

  if (booking && action) {
    await writeWalletSyncState({
      booking,
      action,
      issue: {
        failedAt: new Date().toISOString(),
        attempts,
        lastError: lastError?.message || String(lastError || "wallet sync failed"),
        context: context || null,
      },
    }).catch(() => {});
  }

  throw lastError;
};

export default {
  runWalletBookingMutation,
};
