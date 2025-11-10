import models from "../models/index.js";

export const loadHostHome = async (req, res, next) => {
  try {
    const hostId = Number(req.user?.id);
    const homeId = Number(req.params?.id);
    if (!hostId || !homeId) {
      return res.status(400).json({ error: "Invalid host or home id" });
    }

    const home = await models.Home.findOne({ where: { id: homeId, host_id: hostId } });
    if (!home) {
      return res.status(404).json({ error: "Home not found" });
    }

    req.home = home;
    return next();
  } catch (error) {
    console.error("[loadHostHome]", error);
    return res.status(500).json({ error: "Failed to load home" });
  }
};

