import models from "../../../models/index.js";
import { mapHomeToCard } from "../../../utils/homeMapper.js";
import { formatStaticHotel } from "../../../utils/webbedsMapper.js";

export const getStayDetails = async ({ stayId, type }) => {
  if (!stayId) return null;
  const normalizedType = String(type || "").toUpperCase();

  if (normalizedType === "HOME") {
    const home = await models.Home.findOne({
      where: { id: stayId, status: "PUBLISHED", is_visible: true },
      include: [
        { model: models.HomeAddress, as: "address" },
        { model: models.HomePricing, as: "pricing" },
        { model: models.HomeMedia, as: "media" },
      ],
    });
    if (!home) return null;
    return {
      type: "HOME",
      details: mapHomeToCard(home),
    };
  }

  if (normalizedType === "HOTEL") {
    const hotel = await models.WebbedsHotel.findOne({
      where: { hotel_id: stayId },
      include: [
        { model: models.WebbedsHotelChain, as: "chainCatalog" },
        { model: models.WebbedsHotelClassification, as: "classification" },
      ],
    });
    if (!hotel) return null;
    return {
      type: "HOTEL",
      details: formatStaticHotel(hotel),
    };
  }

  return null;
};
