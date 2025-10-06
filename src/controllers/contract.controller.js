import models from "../models/index.js";
import sendContractNotificationEmail from "../services/sendContractNotificationEmail.js";
const toPlain = (entity) => (entity && typeof entity.get === "function" ? entity.get({ plain: true }) : entity);

const serializeContract = (entity) => {
  const c = toPlain(entity);
  if (!c) return null;
  return {
    id: c.id,
    role: c.role != null ? Number(c.role) : null,
    title: c.title || "",
    content: c.content || "",
    isActive: Boolean(c.is_active ?? c.isActive ?? true),
    publishedAt: c.published_at || null,
    createdAt: c.created_at || null,
    updatedAt: c.updated_at || null,
    deletedAt: c.deleted_at || null,
    acceptedCount: c.acceptedCount ?? c.accepted_count ?? undefined,
  };
};

const serializeAcceptance = (entity) => {
  const a = toPlain(entity);
  if (!a) return null;
  return {
    id: a.id,
    userId: a.user_id,
    contractId: a.contract_id,
    acceptedAt: a.accepted_at,
    acceptedIp: a.accepted_ip || null,
    acceptedUserAgent: a.accepted_user_agent || null,
    contract: serializeContract(a.contract),
  };
};

const notifyUsersOfNewContract = async (contractEntity) => {
  try {
    const plain = toPlain(contractEntity);
    if (!plain) return;

    const role = Number(plain.role);
    const isActive = plain.is_active ?? plain.isActive ?? true;
    if (!role || role === 0 || !isActive) return;

    const users = await models.User.findAll({
      where: { role, is_active: true },
      attributes: ["id", "name", "email"],
    });

    const recipients = users.filter((user) => user?.email);
    if (recipients.length === 0) return;

    await Promise.allSettled(
      recipients.map((user) => sendContractNotificationEmail(user, plain))
    );
  } catch (err) {
    console.error("notifyUsersOfNewContract error:", err);
  }
};

export const adminListContracts = async (req, res, next) => {
  try {
    const { role, includeArchived } = req.query || {};
    const where = {};
    if (role && role !== "all") {
      const roleNum = Number(role);
      if (!Number.isNaN(roleNum)) where.role = roleNum;
    }

    const options = {
      where,
      include: [
        {
          model: models.UserContract,
          as: "acceptances",
          attributes: ["id"],
          required: false,
          paranoid: false,
        },
      ],
      order: [
        ["published_at", "DESC"],
        ["created_at", "DESC"],
      ],
    };
    if (includeArchived === "true") options.paranoid = false;

    const rows = await models.Contract.findAll(options);
    const contracts = rows.map((row) => {
      const plain = row.get({ plain: true });
      const acceptedCount = Array.isArray(plain.acceptances) ? plain.acceptances.length : 0;
      delete plain.acceptances;
      return { ...serializeContract(plain), acceptedCount };
    });

    return res.json({ contracts });
  } catch (err) {
    return next(err);
  }
};

export const adminCreateContract = async (req, res, next) => {
  try {
    const { title, content, role, is_active } = req.body || {};
    const cleanTitle = typeof title === "string" ? title.trim() : "";
    const cleanContent = typeof content === "string" ? content.trim() : "";
    const roleNum = Number(role);

    if (!cleanTitle) return res.status(400).json({ error: "title is required" });
    if (!cleanContent) return res.status(400).json({ error: "content is required" });
    if (!Number.isInteger(roleNum)) return res.status(400).json({ error: "role must be an integer" });
    if (roleNum === 0) return res.status(400).json({ error: "role 0 has no contracts" });

    const contract = await models.Contract.create({
      title: cleanTitle,
      content: cleanContent,
      role: roleNum,
      is_active: is_active == null ? true : Boolean(is_active),
      published_at: new Date(),
    });

    const created = await models.Contract.findByPk(contract.id, {
      include: [
        { model: models.UserContract, as: "acceptances", attributes: ["id"], required: false, paranoid: false },
      ],
    });

    notifyUsersOfNewContract(created);

    return res.status(201).json({ contract: { ...serializeContract(created), acceptedCount: 0 } });
  } catch (err) {
    return next(err);
  }
};

export const adminUpdateContract = async (req, res, next) => {
  try {
    const { id } = req.params;
    const contract = await models.Contract.findByPk(id, { paranoid: false });
    if (!contract) return res.status(404).json({ error: "Contract not found" });

    const { title, content, role, is_active } = req.body || {};
    const updates = {};

    if (title != null) {
      const cleanTitle = String(title).trim();
      if (!cleanTitle) return res.status(400).json({ error: "title cannot be empty" });
      updates.title = cleanTitle;
    }
    if (content != null) {
      const cleanContent = String(content).trim();
      if (!cleanContent) return res.status(400).json({ error: "content cannot be empty" });
      updates.content = cleanContent;
    }
    if (role != null) {
      const roleNum = Number(role);
      if (!Number.isInteger(roleNum)) return res.status(400).json({ error: "role must be an integer" });
      if (roleNum === 0) return res.status(400).json({ error: "role 0 has no contracts" });
      updates.role = roleNum;
    }
    if (is_active != null) {
      updates.is_active = Boolean(is_active);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    await contract.update(updates);

    const refreshed = await models.Contract.findByPk(contract.id, {
      include: [
        { model: models.UserContract, as: "acceptances", attributes: ["id"], required: false, paranoid: false },
      ],
      paranoid: false,
    });

    const plain = refreshed.get({ plain: true });
    const acceptedCount = Array.isArray(plain.acceptances) ? plain.acceptances.length : 0;
    delete plain.acceptances;

    return res.json({ contract: { ...serializeContract(plain), acceptedCount } });
  } catch (err) {
    return next(err);
  }
};

export const adminDeleteContract = async (req, res, next) => {
  try {
    const { id } = req.params;
    const force = req.query.force === "true";
    const count = await models.Contract.destroy({ where: { id }, force });
    if (count === 0) return res.status(404).json({ error: "Contract not found" });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
};

export const getUserContracts = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    const role = Number(req.user?.role) || 0;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (role === 0) return res.json({ pending: [], signed: [] });

    const [activeContracts, acceptances] = await Promise.all([
      models.Contract.findAll({
        where: { role, is_active: true },
        order: [["published_at", "DESC"]],
      }),
      models.UserContract.findAll({
        where: { user_id: userId },
        include: [
          {
            model: models.Contract,
            as: "contract",
            required: true,
            paranoid: false,
            attributes: { exclude: [] },
          },
        ],
        order: [["accepted_at", "DESC"]],
        paranoid: false,
      }),
    ]);

    const acceptedIds = new Set(acceptances.map((row) => row.contract_id));

    const pending = activeContracts
      .filter((contract) => !acceptedIds.has(contract.id))
      .map((contract) => serializeContract(contract));

    const signed = acceptances.map((row) => serializeAcceptance(row));

    return res.json({ pending, signed });
  } catch (err) {
    return next(err);
  }
};

export const getUserContractsSummary = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    const role = Number(req.user?.role) || 0;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (role === 0) return res.json({ pending: 0, signed: 0 });

    const [activeContracts, acceptances] = await Promise.all([
      models.Contract.findAll({ where: { role, is_active: true }, attributes: ["id"] }),
      models.UserContract.findAll({
        where: { user_id: userId },
        attributes: ["contract_id"],
        include: [
          {
            model: models.Contract,
            as: "contract",
            attributes: ["id", "role"],
            paranoid: false,
          },
        ],
        paranoid: false,
      }),
    ]);

    const acceptedIds = new Set(
      acceptances
        .filter((row) => Number(row.contract?.role) === role)
        .map((row) => row.contract_id)
    );

    const pendingCount = activeContracts.filter((contract) => !acceptedIds.has(contract.id)).length;
    const signedCount = acceptedIds.size;

    return res.json({ pending: pendingCount, signed: signedCount });
  } catch (err) {
    return next(err);
  }
};

export const acceptContract = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    const role = Number(req.user?.role) || 0;
    const contractId = Number(req.params.id);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!Number.isInteger(contractId)) return res.status(400).json({ error: "Invalid contract id" });

    const { accepted } = req.body || {};
    if (!(accepted === true || accepted === "true")) {
      return res.status(400).json({ error: "accepted=true is required" });
    }

    const contract = await models.Contract.findByPk(contractId);
    if (!contract) return res.status(404).json({ error: "Contract not found" });
    if (!contract.is_active) return res.status(400).json({ error: "Contract is inactive" });
    if (Number(contract.role) !== role) return res.status(403).json({ error: "Contract not available for your role" });

    let existing = await models.UserContract.findOne({
      where: { user_id: userId, contract_id: contractId },
      include: [
        {
          model: models.Contract,
          as: "contract",
          paranoid: false,
        },
      ],
      paranoid: false,
    });

    const ipHeader = (req.headers["x-forwarded-for"] || "").toString();
    const acceptedIp = ipHeader.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
    const acceptedUserAgent = req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 250) : null;

    if (existing) {
      if (existing.deleted_at) {
        await existing.restore();
        await existing.update({ accepted_at: new Date(), accepted_ip: acceptedIp, accepted_user_agent: acceptedUserAgent });
        existing = await models.UserContract.findByPk(existing.id, {
          include: [{ model: models.Contract, as: "contract", paranoid: false }],
        });
        return res.json({ acceptance: serializeAcceptance(existing) });
      }
      return res.json({ acceptance: serializeAcceptance(existing) });
    }

    const acceptance = await models.UserContract.create({
      user_id: userId,
      contract_id: contractId,
      accepted_at: new Date(),
      accepted_ip: acceptedIp,
      accepted_user_agent: acceptedUserAgent,
    });

    const withContract = await models.UserContract.findByPk(acceptance.id, {
      include: [{ model: models.Contract, as: "contract", paranoid: false }],
    });

    return res.status(201).json({ acceptance: serializeAcceptance(withContract) });
  } catch (err) {
    if (err?.name === "SequelizeUniqueConstraintError") {
      try {
        const fallback = await models.UserContract.findOne({
          where: { user_id: req.user.id, contract_id: req.params.id },
          include: [{ model: models.Contract, as: "contract", paranoid: false }],
        });
        if (fallback) return res.json({ acceptance: serializeAcceptance(fallback) });
      } catch (inner) {
        return next(inner);
      }
    }
    return next(err);
  }
};
