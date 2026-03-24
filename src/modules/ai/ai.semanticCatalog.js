const stripDiacritics = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export const normalizeSemanticCatalogText = (value = "") =>
  stripDiacritics(String(value || "").toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const uniqueList = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  );

const uniqueUpperList = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((entry) => String(entry || "").trim().toUpperCase())
        .filter(Boolean),
    ),
  );

const buildZone = ({
  id,
  name,
  aliases = [],
  traits = [],
  radiusMeters = 2600,
  lat = null,
  lng = null,
  adjacent = [],
}) => ({
  id,
  name,
  aliases: uniqueList(aliases),
  traits: uniqueUpperList(traits),
  radiusMeters,
  lat,
  lng,
  adjacent: uniqueList(adjacent),
});

const buildLandmark = ({
  id,
  name,
  aliases = [],
  zoneIds = [],
  traits = [],
  radiusMeters = 1600,
  lat = null,
  lng = null,
}) => ({
  id,
  name,
  aliases: uniqueList(aliases),
  zoneIds: uniqueList(zoneIds),
  traits: uniqueUpperList(traits),
  radiusMeters,
  lat,
  lng,
});

const buildCity = ({
  city,
  country,
  aliases = [],
  zones = [],
  landmarks = [],
}) => ({
  city,
  country,
  aliases: uniqueList(aliases),
  zones,
  landmarks,
});

const TRAITS = {
  SAFE: "SAFE",
  WALKABLE: "WALKABLE",
  UPSCALE_AREA: "UPSCALE_AREA",
  QUIET: "QUIET",
  NIGHTLIFE: "NIGHTLIFE",
  FAMILY: "FAMILY",
  BUSINESS: "BUSINESS",
  CENTRAL: "CENTRAL",
  CULTURAL: "CULTURAL",
  WATERFRONT_AREA: "WATERFRONT_AREA",
};

export const SEMANTIC_INTENT_PROFILE_VERSION = "2026.03.enterprise.v1";
export const SEMANTIC_INTENT_PROFILE_TRAITS = Object.freeze(
  Object.values(TRAITS),
);

const CITY_CATALOG = [
  buildCity({
    city: "Buenos Aires",
    country: "Argentina",
    aliases: ["CABA", "Capital Federal"],
    zones: [
      buildZone({
        id: "ba-recoleta",
        name: "Recoleta",
        aliases: ["la recoleta"],
        traits: [TRAITS.SAFE, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA, TRAITS.CULTURAL],
        radiusMeters: 2200,
        lat: -34.5882,
        lng: -58.3929,
        adjacent: ["ba-palermo-soho", "ba-san-telmo"],
      }),
      buildZone({
        id: "ba-palermo-soho",
        name: "Palermo Soho",
        aliases: ["palermo", "palermo hollywood"],
        traits: [TRAITS.WALKABLE, TRAITS.NIGHTLIFE, TRAITS.UPSCALE_AREA],
        radiusMeters: 2600,
        lat: -34.5889,
        lng: -58.4291,
        adjacent: ["ba-recoleta", "ba-belgrano"],
      }),
      buildZone({
        id: "ba-puerto-madero",
        name: "Puerto Madero",
        aliases: ["madero", "docklands"],
        traits: [TRAITS.WATERFRONT_AREA, TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.WALKABLE],
        radiusMeters: 2400,
        lat: -34.6076,
        lng: -58.3635,
        adjacent: ["ba-san-telmo", "ba-microcentro"],
      }),
      buildZone({
        id: "ba-belgrano",
        name: "Belgrano",
        aliases: ["barrio chino"],
        traits: [TRAITS.SAFE, TRAITS.FAMILY, TRAITS.QUIET, TRAITS.WALKABLE],
        radiusMeters: 2800,
        lat: -34.5633,
        lng: -58.4571,
      }),
      buildZone({
        id: "ba-san-telmo",
        name: "San Telmo",
        aliases: ["casco historico", "historic center"],
        traits: [TRAITS.CULTURAL, TRAITS.WALKABLE, TRAITS.NIGHTLIFE],
        radiusMeters: 2200,
        lat: -34.6217,
        lng: -58.3715,
        adjacent: ["ba-puerto-madero", "ba-microcentro"],
      }),
      buildZone({
        id: "ba-microcentro",
        name: "Microcentro",
        aliases: ["downtown", "centro", "city center"],
        traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WALKABLE],
        radiusMeters: 2200,
        lat: -34.6037,
        lng: -58.3816,
      }),
    ],
    landmarks: [
      buildLandmark({
        id: "ba-obelisco",
        name: "Obelisco",
        aliases: ["obelisk"],
        zoneIds: ["ba-microcentro"],
        traits: [TRAITS.CENTRAL, TRAITS.CULTURAL],
        lat: -34.6037,
        lng: -58.3816,
      }),
      buildLandmark({
        id: "ba-recoleta-cemetery",
        name: "Recoleta Cemetery",
        aliases: ["cementerio de recoleta"],
        zoneIds: ["ba-recoleta"],
        traits: [TRAITS.CULTURAL],
        lat: -34.5881,
        lng: -58.3924,
      }),
    ],
  }),
  buildCity({
    city: "Dubai",
    country: "United Arab Emirates",
    zones: [
      buildZone({
        id: "dubai-downtown",
        name: "Downtown Dubai",
        aliases: ["downtown"],
        traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.WALKABLE],
        radiusMeters: 2600,
        lat: 25.1972,
        lng: 55.2744,
      }),
      buildZone({
        id: "dubai-business-bay",
        name: "Business Bay",
        aliases: ["business bay canal"],
        traits: [TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.WATERFRONT_AREA],
        radiusMeters: 2600,
        lat: 25.1866,
        lng: 55.2654,
      }),
      buildZone({
        id: "dubai-marina",
        name: "Dubai Marina",
        aliases: ["marina", "marina walk"],
        traits: [TRAITS.WATERFRONT_AREA, TRAITS.NIGHTLIFE, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA],
        radiusMeters: 3000,
        lat: 25.0804,
        lng: 55.1403,
      }),
      buildZone({
        id: "dubai-jbr",
        name: "JBR",
        aliases: ["jumeirah beach residence", "the beach jbr"],
        traits: [TRAITS.WATERFRONT_AREA, TRAITS.WALKABLE, TRAITS.FAMILY, TRAITS.NIGHTLIFE],
        radiusMeters: 2600,
        lat: 25.08,
        lng: 55.135,
      }),
      buildZone({
        id: "dubai-palm",
        name: "Palm Jumeirah",
        aliases: ["the palm"],
        traits: [TRAITS.WATERFRONT_AREA, TRAITS.UPSCALE_AREA, TRAITS.FAMILY, TRAITS.QUIET],
        radiusMeters: 3800,
        lat: 25.1124,
        lng: 55.1388,
      }),
      buildZone({
        id: "dubai-difc",
        name: "DIFC",
        aliases: ["dubai international financial centre", "financial center"],
        traits: [TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.CENTRAL],
        radiusMeters: 2200,
        lat: 25.2116,
        lng: 55.2797,
      }),
    ],
    landmarks: [
      buildLandmark({
        id: "dubai-burj-khalifa",
        name: "Burj Khalifa",
        aliases: ["burj"],
        zoneIds: ["dubai-downtown"],
        traits: [TRAITS.CENTRAL, TRAITS.CULTURAL],
        lat: 25.1972,
        lng: 55.2744,
      }),
      buildLandmark({
        id: "dubai-dubai-mall",
        name: "Dubai Mall",
        zoneIds: ["dubai-downtown"],
        traits: [TRAITS.CENTRAL, TRAITS.WALKABLE],
        lat: 25.1985,
        lng: 55.2796,
      }),
    ],
  }),
  buildCity({
    city: "Tokyo",
    country: "Japan",
    zones: [
      buildZone({ id: "tokyo-ginza", name: "Ginza", traits: [TRAITS.UPSCALE_AREA, TRAITS.WALKABLE, TRAITS.CENTRAL, TRAITS.BUSINESS], radiusMeters: 2200, lat: 35.6717, lng: 139.765 }),
      buildZone({ id: "tokyo-shinjuku", name: "Shinjuku", traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.BUSINESS, TRAITS.WALKABLE], radiusMeters: 2600, lat: 35.6938, lng: 139.7034 }),
      buildZone({ id: "tokyo-shibuya", name: "Shibuya", traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE, TRAITS.CENTRAL], radiusMeters: 2400, lat: 35.6595, lng: 139.7005 }),
      buildZone({ id: "tokyo-asakusa", name: "Asakusa", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE], radiusMeters: 2200, lat: 35.7148, lng: 139.7967 }),
      buildZone({ id: "tokyo-roppongi", name: "Roppongi", traits: [TRAITS.NIGHTLIFE, TRAITS.UPSCALE_AREA, TRAITS.BUSINESS], radiusMeters: 2200, lat: 35.6628, lng: 139.731 }),
      buildZone({ id: "tokyo-marunouchi", name: "Marunouchi", aliases: ["tokyo station area"], traits: [TRAITS.BUSINESS, TRAITS.CENTRAL, TRAITS.WALKABLE], radiusMeters: 2200, lat: 35.6812, lng: 139.7671 }),
    ],
    landmarks: [
      buildLandmark({ id: "tokyo-station", name: "Tokyo Station", zoneIds: ["tokyo-marunouchi"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS], lat: 35.6812, lng: 139.7671 }),
      buildLandmark({ id: "tokyo-skytree", name: "Tokyo Skytree", zoneIds: ["tokyo-asakusa"], traits: [TRAITS.CULTURAL], lat: 35.7101, lng: 139.8107 }),
      buildLandmark({ id: "tokyo-shibuya-crossing", name: "Shibuya Crossing", zoneIds: ["tokyo-shibuya"], traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE], lat: 35.6595, lng: 139.7005 }),
    ],
  }),
  buildCity({
    city: "Kyoto",
    country: "Japan",
    zones: [
      buildZone({ id: "kyoto-gion", name: "Gion", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA], radiusMeters: 2000, lat: 35.0037, lng: 135.7788 }),
      buildZone({ id: "kyoto-higashiyama", name: "Higashiyama", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE, TRAITS.QUIET], radiusMeters: 2600, lat: 34.9971, lng: 135.7809 }),
      buildZone({ id: "kyoto-kawaramachi", name: "Kawaramachi", traits: [TRAITS.CENTRAL, TRAITS.WALKABLE, TRAITS.NIGHTLIFE], radiusMeters: 2200, lat: 35.0034, lng: 135.7681 }),
      buildZone({ id: "kyoto-station", name: "Kyoto Station", aliases: ["station area"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS], radiusMeters: 2200, lat: 34.9858, lng: 135.7588 }),
      buildZone({ id: "kyoto-arashiyama", name: "Arashiyama", traits: [TRAITS.CULTURAL, TRAITS.QUIET, TRAITS.FAMILY], radiusMeters: 2600, lat: 35.0094, lng: 135.6668 }),
    ],
    landmarks: [
      buildLandmark({ id: "kyoto-kiyomizu", name: "Kiyomizu-dera", aliases: ["kiyomizudera"], zoneIds: ["kyoto-higashiyama"], traits: [TRAITS.CULTURAL], lat: 34.9948, lng: 135.785 }),
      buildLandmark({ id: "kyoto-fushimi-inari", name: "Fushimi Inari", zoneIds: ["kyoto-station"], traits: [TRAITS.CULTURAL], lat: 34.9671, lng: 135.7727 }),
    ],
  }),
  buildCity({
    city: "Osaka",
    country: "Japan",
    zones: [
      buildZone({ id: "osaka-namba", name: "Namba", traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE], radiusMeters: 2400, lat: 34.6661, lng: 135.5012 }),
      buildZone({ id: "osaka-umeda", name: "Umeda", traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WALKABLE], radiusMeters: 2400, lat: 34.7025, lng: 135.4959 }),
      buildZone({ id: "osaka-shinsaibashi", name: "Shinsaibashi", traits: [TRAITS.WALKABLE, TRAITS.NIGHTLIFE, TRAITS.CENTRAL], radiusMeters: 2200, lat: 34.6751, lng: 135.5019 }),
      buildZone({ id: "osaka-tennoji", name: "Tennoji", traits: [TRAITS.CENTRAL, TRAITS.CULTURAL, TRAITS.FAMILY], radiusMeters: 2600, lat: 34.6454, lng: 135.5138 }),
      buildZone({ id: "osaka-bay", name: "Bay Area", aliases: ["universal studios area"], traits: [TRAITS.WATERFRONT_AREA, TRAITS.FAMILY], radiusMeters: 3600, lat: 34.6654, lng: 135.4305 }),
    ],
  }),
  buildCity({
    city: "New York",
    country: "United States",
    aliases: ["New York City", "NYC"],
    zones: [
      buildZone({ id: "ny-midtown", name: "Midtown", aliases: ["midtown manhattan", "times square area"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WALKABLE] }),
      buildZone({ id: "ny-upper-east", name: "Upper East Side", traits: [TRAITS.SAFE, TRAITS.UPSCALE_AREA, TRAITS.QUIET, TRAITS.CULTURAL] }),
      buildZone({ id: "ny-soho", name: "SoHo", traits: [TRAITS.WALKABLE, TRAITS.UPSCALE_AREA, TRAITS.NIGHTLIFE] }),
      buildZone({ id: "ny-greenwich", name: "Greenwich Village", aliases: ["west village"], traits: [TRAITS.WALKABLE, TRAITS.CULTURAL, TRAITS.NIGHTLIFE] }),
      buildZone({ id: "ny-financial", name: "Financial District", aliases: ["fidi"], traits: [TRAITS.BUSINESS, TRAITS.CENTRAL, TRAITS.WATERFRONT_AREA] }),
    ],
  }),
  buildCity({
    city: "Miami",
    country: "United States",
    zones: [
      buildZone({ id: "miami-south-beach", name: "South Beach", aliases: ["sobe"], traits: [TRAITS.WATERFRONT_AREA, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "miami-brickell", name: "Brickell", traits: [TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.CENTRAL, TRAITS.WALKABLE] }),
      buildZone({ id: "miami-downtown", name: "Downtown Miami", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WATERFRONT_AREA] }),
      buildZone({ id: "miami-coconut-grove", name: "Coconut Grove", traits: [TRAITS.QUIET, TRAITS.WALKABLE, TRAITS.FAMILY] }),
      buildZone({ id: "miami-coral-gables", name: "Coral Gables", traits: [TRAITS.SAFE, TRAITS.UPSCALE_AREA, TRAITS.QUIET] }),
    ],
  }),
  buildCity({
    city: "Los Angeles",
    country: "United States",
    zones: [
      buildZone({ id: "la-santa-monica", name: "Santa Monica", traits: [TRAITS.WATERFRONT_AREA, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA, TRAITS.FAMILY] }),
      buildZone({ id: "la-west-hollywood", name: "West Hollywood", aliases: ["weho"], traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "la-beverly-hills", name: "Beverly Hills", traits: [TRAITS.UPSCALE_AREA, TRAITS.SAFE, TRAITS.QUIET] }),
      buildZone({ id: "la-downtown", name: "Downtown Los Angeles", aliases: ["dtla"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.CULTURAL] }),
      buildZone({ id: "la-hollywood", name: "Hollywood", traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.CULTURAL] }),
    ],
  }),
  buildCity({
    city: "San Francisco",
    country: "United States",
    zones: [
      buildZone({ id: "sf-union-square", name: "Union Square", traits: [TRAITS.CENTRAL, TRAITS.WALKABLE, TRAITS.BUSINESS] }),
      buildZone({ id: "sf-soma", name: "SoMa", traits: [TRAITS.BUSINESS, TRAITS.CENTRAL] }),
      buildZone({ id: "sf-fishermans-wharf", name: "Fisherman's Wharf", aliases: ["fishermans wharf"], traits: [TRAITS.WATERFRONT_AREA, TRAITS.FAMILY, TRAITS.WALKABLE] }),
      buildZone({ id: "sf-nob-hill", name: "Nob Hill", traits: [TRAITS.UPSCALE_AREA, TRAITS.SAFE, TRAITS.CENTRAL] }),
      buildZone({ id: "sf-marina", name: "Marina District", aliases: ["marina"], traits: [TRAITS.WALKABLE, TRAITS.WATERFRONT_AREA, TRAITS.UPSCALE_AREA] }),
    ],
  }),
  buildCity({
    city: "Las Vegas",
    country: "United States",
    zones: [
      buildZone({ id: "vegas-strip", name: "The Strip", aliases: ["las vegas strip"], traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "vegas-downtown", name: "Downtown Las Vegas", aliases: ["fremont"], traits: [TRAITS.NIGHTLIFE, TRAITS.CENTRAL] }),
      buildZone({ id: "vegas-summerlin", name: "Summerlin", traits: [TRAITS.QUIET, TRAITS.FAMILY, TRAITS.UPSCALE_AREA] }),
    ],
  }),
  buildCity({
    city: "Orlando",
    country: "United States",
    zones: [
      buildZone({ id: "orlando-lake-buena-vista", name: "Lake Buena Vista", traits: [TRAITS.FAMILY, TRAITS.WALKABLE] }),
      buildZone({ id: "orlando-international-drive", name: "International Drive", aliases: ["i drive", "i-drive"], traits: [TRAITS.FAMILY, TRAITS.WALKABLE, TRAITS.CENTRAL] }),
      buildZone({ id: "orlando-downtown", name: "Downtown Orlando", traits: [TRAITS.CENTRAL, TRAITS.BUSINESS] }),
    ],
  }),
  buildCity({
    city: "Chicago",
    country: "United States",
    zones: [
      buildZone({ id: "chicago-loop", name: "The Loop", aliases: ["loop"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WALKABLE] }),
      buildZone({ id: "chicago-river-north", name: "River North", traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "chicago-gold-coast", name: "Gold Coast", traits: [TRAITS.UPSCALE_AREA, TRAITS.SAFE, TRAITS.WALKABLE] }),
      buildZone({ id: "chicago-west-loop", name: "West Loop", traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE, TRAITS.CULTURAL] }),
    ],
  }),
  buildCity({
    city: "Boston",
    country: "United States",
    zones: [
      buildZone({ id: "boston-back-bay", name: "Back Bay", traits: [TRAITS.UPSCALE_AREA, TRAITS.WALKABLE, TRAITS.CENTRAL] }),
      buildZone({ id: "boston-beacon-hill", name: "Beacon Hill", traits: [TRAITS.SAFE, TRAITS.CULTURAL, TRAITS.WALKABLE] }),
      buildZone({ id: "boston-seaport", name: "Seaport", traits: [TRAITS.WATERFRONT_AREA, TRAITS.BUSINESS, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "boston-north-end", name: "North End", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Washington",
    country: "United States",
    aliases: ["Washington DC", "Washington D.C.", "DC"],
    zones: [
      buildZone({ id: "dc-georgetown", name: "Georgetown", traits: [TRAITS.WALKABLE, TRAITS.CULTURAL, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "dc-dupont", name: "Dupont Circle", traits: [TRAITS.WALKABLE, TRAITS.NIGHTLIFE, TRAITS.CENTRAL] }),
      buildZone({ id: "dc-downtown", name: "Downtown DC", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS] }),
      buildZone({ id: "dc-wharf", name: "The Wharf", traits: [TRAITS.WATERFRONT_AREA, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "dc-capitol-hill", name: "Capitol Hill", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Seattle",
    country: "United States",
    zones: [
      buildZone({ id: "seattle-downtown", name: "Downtown Seattle", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WALKABLE] }),
      buildZone({ id: "seattle-belltown", name: "Belltown", traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE, TRAITS.CENTRAL] }),
      buildZone({ id: "seattle-capitol-hill", name: "Capitol Hill", traits: [TRAITS.NIGHTLIFE, TRAITS.CULTURAL, TRAITS.WALKABLE] }),
      buildZone({ id: "seattle-slu", name: "South Lake Union", traits: [TRAITS.BUSINESS, TRAITS.WATERFRONT_AREA] }),
    ],
  }),
  buildCity({
    city: "Austin",
    country: "United States",
    zones: [
      buildZone({ id: "austin-downtown", name: "Downtown Austin", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "austin-soco", name: "South Congress", aliases: ["SoCo"], traits: [TRAITS.WALKABLE, TRAITS.CULTURAL, TRAITS.NIGHTLIFE] }),
      buildZone({ id: "austin-zilker", name: "Zilker", traits: [TRAITS.QUIET, TRAITS.FAMILY] }),
      buildZone({ id: "austin-domain", name: "The Domain", traits: [TRAITS.BUSINESS, TRAITS.UPSCALE_AREA] }),
    ],
  }),
  buildCity({
    city: "Nashville",
    country: "United States",
    zones: [
      buildZone({ id: "nashville-downtown", name: "Downtown Nashville", aliases: ["broadway"], traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "nashville-gulch", name: "The Gulch", traits: [TRAITS.UPSCALE_AREA, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "nashville-midtown", name: "Midtown", traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "New Orleans",
    country: "United States",
    zones: [
      buildZone({ id: "nola-french-quarter", name: "French Quarter", traits: [TRAITS.CULTURAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "nola-cbd", name: "CBD", aliases: ["warehouse district"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WALKABLE] }),
      buildZone({ id: "nola-garden-district", name: "Garden District", traits: [TRAITS.CULTURAL, TRAITS.QUIET, TRAITS.UPSCALE_AREA] }),
    ],
  }),
  buildCity({
    city: "Honolulu",
    country: "United States",
    zones: [
      buildZone({ id: "honolulu-waikiki", name: "Waikiki", traits: [TRAITS.WATERFRONT_AREA, TRAITS.WALKABLE, TRAITS.NIGHTLIFE, TRAITS.FAMILY] }),
      buildZone({ id: "honolulu-ala-moana", name: "Ala Moana", traits: [TRAITS.WATERFRONT_AREA, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "honolulu-diamond-head", name: "Diamond Head", traits: [TRAITS.QUIET, TRAITS.UPSCALE_AREA, TRAITS.WATERFRONT_AREA] }),
    ],
  }),
  buildCity({
    city: "Atlanta",
    country: "United States",
    zones: [
      buildZone({ id: "atlanta-midtown", name: "Midtown", traits: [TRAITS.CENTRAL, TRAITS.WALKABLE, TRAITS.BUSINESS] }),
      buildZone({ id: "atlanta-buckhead", name: "Buckhead", traits: [TRAITS.UPSCALE_AREA, TRAITS.SAFE, TRAITS.BUSINESS] }),
      buildZone({ id: "atlanta-old-fourth", name: "Old Fourth Ward", traits: [TRAITS.CULTURAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Dallas",
    country: "United States",
    zones: [
      buildZone({ id: "dallas-uptown", name: "Uptown", traits: [TRAITS.WALKABLE, TRAITS.NIGHTLIFE, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "dallas-downtown", name: "Downtown Dallas", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS] }),
      buildZone({ id: "dallas-deep-ellum", name: "Deep Ellum", traits: [TRAITS.NIGHTLIFE, TRAITS.CULTURAL] }),
      buildZone({ id: "dallas-bishop-arts", name: "Bishop Arts", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Houston",
    country: "United States",
    zones: [
      buildZone({ id: "houston-downtown", name: "Downtown Houston", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS] }),
      buildZone({ id: "houston-galleria", name: "Galleria", aliases: ["uptown"], traits: [TRAITS.UPSCALE_AREA, TRAITS.BUSINESS] }),
      buildZone({ id: "houston-river-oaks", name: "River Oaks", traits: [TRAITS.UPSCALE_AREA, TRAITS.SAFE, TRAITS.QUIET] }),
      buildZone({ id: "houston-museum", name: "Museum District", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Philadelphia",
    country: "United States",
    zones: [
      buildZone({ id: "philly-center-city", name: "Center City", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.WALKABLE, TRAITS.BUSINESS] }),
      buildZone({ id: "philly-rittenhouse", name: "Rittenhouse Square", traits: [TRAITS.UPSCALE_AREA, TRAITS.WALKABLE, TRAITS.SAFE] }),
      buildZone({ id: "philly-old-city", name: "Old City", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE] }),
      buildZone({ id: "philly-fishtown", name: "Fishtown", traits: [TRAITS.NIGHTLIFE, TRAITS.CULTURAL] }),
    ],
  }),
  buildCity({
    city: "Phoenix",
    country: "United States",
    aliases: ["Scottsdale"],
    zones: [
      buildZone({ id: "phoenix-old-town", name: "Old Town Scottsdale", aliases: ["scottsdale", "old town"], traits: [TRAITS.UPSCALE_AREA, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "phoenix-downtown", name: "Downtown Phoenix", aliases: ["downtown"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS] }),
      buildZone({ id: "phoenix-biltmore", name: "Biltmore", traits: [TRAITS.UPSCALE_AREA, TRAITS.BUSINESS, TRAITS.QUIET] }),
    ],
  }),
  buildCity({
    city: "San Diego",
    country: "United States",
    zones: [
      buildZone({ id: "sd-gaslamp", name: "Gaslamp Quarter", traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "sd-lajolla", name: "La Jolla", traits: [TRAITS.WATERFRONT_AREA, TRAITS.UPSCALE_AREA, TRAITS.QUIET] }),
      buildZone({ id: "sd-little-italy", name: "Little Italy", traits: [TRAITS.WALKABLE, TRAITS.CULTURAL] }),
      buildZone({ id: "sd-mission-bay", name: "Mission Bay", traits: [TRAITS.WATERFRONT_AREA, TRAITS.FAMILY] }),
    ],
  }),
  buildCity({
    city: "Mexico City",
    country: "Mexico",
    aliases: ["CDMX", "Ciudad de Mexico"],
    zones: [
      buildZone({ id: "cdmx-polanco", name: "Polanco", traits: [TRAITS.UPSCALE_AREA, TRAITS.SAFE, TRAITS.WALKABLE, TRAITS.BUSINESS] }),
      buildZone({ id: "cdmx-roma", name: "Roma Norte", aliases: ["roma"], traits: [TRAITS.WALKABLE, TRAITS.CULTURAL, TRAITS.NIGHTLIFE] }),
      buildZone({ id: "cdmx-condesa", name: "Condesa", traits: [TRAITS.WALKABLE, TRAITS.NIGHTLIFE, TRAITS.CULTURAL] }),
      buildZone({ id: "cdmx-reforma", name: "Reforma", traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "cdmx-coyoacan", name: "Coyoacan", aliases: ["coyoacán"], traits: [TRAITS.CULTURAL, TRAITS.QUIET, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Rio de Janeiro",
    country: "Brazil",
    aliases: ["Rio"],
    zones: [
      buildZone({ id: "rio-ipanema", name: "Ipanema", traits: [TRAITS.WATERFRONT_AREA, TRAITS.UPSCALE_AREA, TRAITS.WALKABLE] }),
      buildZone({ id: "rio-leblon", name: "Leblon", traits: [TRAITS.WATERFRONT_AREA, TRAITS.UPSCALE_AREA, TRAITS.SAFE] }),
      buildZone({ id: "rio-copacabana", name: "Copacabana", traits: [TRAITS.WATERFRONT_AREA, TRAITS.WALKABLE, TRAITS.NIGHTLIFE] }),
      buildZone({ id: "rio-botafogo", name: "Botafogo", traits: [TRAITS.CENTRAL, TRAITS.CULTURAL] }),
      buildZone({ id: "rio-barra", name: "Barra da Tijuca", aliases: ["barra"], traits: [TRAITS.WATERFRONT_AREA, TRAITS.FAMILY, TRAITS.UPSCALE_AREA] }),
    ],
  }),
  buildCity({
    city: "Sao Paulo",
    country: "Brazil",
    aliases: ["São Paulo"],
    zones: [
      buildZone({ id: "sp-jardins", name: "Jardins", traits: [TRAITS.UPSCALE_AREA, TRAITS.SAFE, TRAITS.WALKABLE] }),
      buildZone({ id: "sp-itaim", name: "Itaim Bibi", traits: [TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.NIGHTLIFE] }),
      buildZone({ id: "sp-vila-madalena", name: "Vila Madalena", traits: [TRAITS.NIGHTLIFE, TRAITS.CULTURAL, TRAITS.WALKABLE] }),
      buildZone({ id: "sp-pinheiros", name: "Pinheiros", traits: [TRAITS.WALKABLE, TRAITS.NIGHTLIFE, TRAITS.BUSINESS] }),
      buildZone({ id: "sp-moema", name: "Moema", traits: [TRAITS.SAFE, TRAITS.BUSINESS] }),
    ],
  }),
  buildCity({
    city: "Lima",
    country: "Peru",
    zones: [
      buildZone({ id: "lima-miraflores", name: "Miraflores", traits: [TRAITS.WATERFRONT_AREA, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA, TRAITS.SAFE] }),
      buildZone({ id: "lima-barranco", name: "Barranco", traits: [TRAITS.CULTURAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "lima-san-isidro", name: "San Isidro", traits: [TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.SAFE] }),
    ],
  }),
  buildCity({
    city: "Bogota",
    country: "Colombia",
    aliases: ["Bogotá"],
    zones: [
      buildZone({ id: "bogota-parque93", name: "Parque 93", traits: [TRAITS.UPSCALE_AREA, TRAITS.NIGHTLIFE, TRAITS.BUSINESS] }),
      buildZone({ id: "bogota-zona-t", name: "Zona T", aliases: ["zona rosa"], traits: [TRAITS.NIGHTLIFE, TRAITS.UPSCALE_AREA, TRAITS.WALKABLE] }),
      buildZone({ id: "bogota-usaquen", name: "Usaquen", aliases: ["Usaquén"], traits: [TRAITS.SAFE, TRAITS.WALKABLE, TRAITS.CULTURAL] }),
      buildZone({ id: "bogota-candelaria", name: "La Candelaria", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Medellin",
    country: "Colombia",
    aliases: ["Medellín"],
    zones: [
      buildZone({ id: "medellin-poblado", name: "El Poblado", traits: [TRAITS.UPSCALE_AREA, TRAITS.NIGHTLIFE, TRAITS.BUSINESS] }),
      buildZone({ id: "medellin-provenza", name: "Provenza", traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "medellin-laureles", name: "Laureles", traits: [TRAITS.WALKABLE, TRAITS.QUIET, TRAITS.CULTURAL] }),
      buildZone({ id: "medellin-envigado", name: "Envigado", traits: [TRAITS.FAMILY, TRAITS.QUIET, TRAITS.SAFE] }),
    ],
  }),
  buildCity({
    city: "Santiago",
    country: "Chile",
    zones: [
      buildZone({ id: "santiago-providencia", name: "Providencia", traits: [TRAITS.WALKABLE, TRAITS.BUSINESS, TRAITS.SAFE] }),
      buildZone({ id: "santiago-las-condes", name: "Las Condes", traits: [TRAITS.BUSINESS, TRAITS.UPSCALE_AREA, TRAITS.SAFE] }),
      buildZone({ id: "santiago-bellas-artes", name: "Bellas Artes", aliases: ["lastarria"], traits: [TRAITS.CULTURAL, TRAITS.WALKABLE, TRAITS.NIGHTLIFE] }),
      buildZone({ id: "santiago-vitacura", name: "Vitacura", traits: [TRAITS.UPSCALE_AREA, TRAITS.QUIET, TRAITS.SAFE] }),
    ],
  }),
  buildCity({
    city: "Cartagena",
    country: "Colombia",
    zones: [
      buildZone({ id: "cartagena-old-city", name: "Old City", aliases: ["centro historico", "centro histórico"], traits: [TRAITS.CULTURAL, TRAITS.WALKABLE, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "cartagena-getsemani", name: "Getsemani", aliases: ["Getsemaní"], traits: [TRAITS.CULTURAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "cartagena-bocagrande", name: "Bocagrande", traits: [TRAITS.WATERFRONT_AREA, TRAITS.UPSCALE_AREA] }),
      buildZone({ id: "cartagena-castillogrande", name: "Castillogrande", traits: [TRAITS.WATERFRONT_AREA, TRAITS.QUIET, TRAITS.UPSCALE_AREA] }),
    ],
  }),
  buildCity({
    city: "Punta Cana",
    country: "Dominican Republic",
    zones: [
      buildZone({ id: "pc-bavaro", name: "Bavaro", aliases: ["Bávaro"], traits: [TRAITS.WATERFRONT_AREA, TRAITS.FAMILY, TRAITS.WALKABLE] }),
      buildZone({ id: "pc-cap-cana", name: "Cap Cana", traits: [TRAITS.WATERFRONT_AREA, TRAITS.UPSCALE_AREA, TRAITS.QUIET] }),
      buildZone({ id: "pc-uvero-alto", name: "Uvero Alto", traits: [TRAITS.WATERFRONT_AREA, TRAITS.QUIET, TRAITS.FAMILY] }),
    ],
  }),
  buildCity({
    city: "Yokohama",
    country: "Japan",
    zones: [
      buildZone({ id: "yokohama-minato-mirai", name: "Minato Mirai", traits: [TRAITS.WATERFRONT_AREA, TRAITS.BUSINESS, TRAITS.WALKABLE] }),
      buildZone({ id: "yokohama-kannai", name: "Kannai", traits: [TRAITS.CENTRAL, TRAITS.CULTURAL] }),
      buildZone({ id: "yokohama-chinatown", name: "Chinatown", traits: [TRAITS.CULTURAL, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Fukuoka",
    country: "Japan",
    zones: [
      buildZone({ id: "fukuoka-hakata", name: "Hakata", traits: [TRAITS.CENTRAL, TRAITS.BUSINESS, TRAITS.WALKABLE] }),
      buildZone({ id: "fukuoka-tenjin", name: "Tenjin", traits: [TRAITS.CENTRAL, TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "fukuoka-ohori", name: "Ohori", aliases: ["Ohori Park"], traits: [TRAITS.QUIET, TRAITS.FAMILY, TRAITS.WALKABLE] }),
    ],
  }),
  buildCity({
    city: "Sapporo",
    country: "Japan",
    zones: [
      buildZone({ id: "sapporo-odori", name: "Odori", aliases: ["Odori Park"], traits: [TRAITS.CENTRAL, TRAITS.WALKABLE] }),
      buildZone({ id: "sapporo-susukino", name: "Susukino", traits: [TRAITS.NIGHTLIFE, TRAITS.WALKABLE] }),
      buildZone({ id: "sapporo-station", name: "Sapporo Station", aliases: ["station area"], traits: [TRAITS.CENTRAL, TRAITS.BUSINESS] }),
    ],
  }),
];

const CITY_CATALOG_BY_KEY = new Map();

CITY_CATALOG.forEach((entry) => {
  const primaryKey = `${normalizeSemanticCatalogText(entry.city)}|${normalizeSemanticCatalogText(entry.country)}`;
  CITY_CATALOG_BY_KEY.set(primaryKey, entry);
  CITY_CATALOG_BY_KEY.set(normalizeSemanticCatalogText(entry.city), entry);
  (entry.aliases || []).forEach((alias) => {
    CITY_CATALOG_BY_KEY.set(normalizeSemanticCatalogText(alias), entry);
    CITY_CATALOG_BY_KEY.set(
      `${normalizeSemanticCatalogText(alias)}|${normalizeSemanticCatalogText(entry.country)}`,
      entry,
    );
  });
});

const buildCatalogEntityTokens = (entry = {}) =>
  uniqueList([entry.name, ...(entry.aliases || [])])
    .map((token) => normalizeSemanticCatalogText(token))
    .filter(Boolean);

const matchCatalogEntityByText = (entry = {}, rawValue = "") => {
  const target = normalizeSemanticCatalogText(rawValue);
  if (!target) return false;
  return buildCatalogEntityTokens(entry).some(
    (token) => token === target || token.includes(target) || target.includes(token),
  );
};

const detectBusinessSignal = (text = "") =>
  /\b(business|work trip|work|corporate|conference|congreso|negocios)\b/.test(
    normalizeSemanticCatalogText(text),
  );

const detectCulturalSignal = (text = "") =>
  /\b(cultural|culture|historic|history|museum|museo|arte|art|heritage)\b/.test(
    normalizeSemanticCatalogText(text),
  );

const detectCentralSignal = (text = "") =>
  /\b(city center|downtown|centro|central)\b/.test(
    normalizeSemanticCatalogText(text),
  );

const deriveRequestedAreaTraits = ({ plan = {}, latestUserMessage = "" } = {}) => {
  const traits = new Set();
  const areaIntent = String(plan?.areaIntent || "").trim().toUpperCase();
  const areaTraits = Array.isArray(plan?.areaTraits) ? plan.areaTraits : [];
  const preferenceNotes = Array.isArray(plan?.preferenceNotes) ? plan.preferenceNotes : [];
  const viewIntent = String(plan?.viewIntent || "").trim().toUpperCase();
  const qualityIntent = String(plan?.qualityIntent || "").trim().toUpperCase();
  const rawText = [latestUserMessage, ...preferenceNotes].join(" ");

  if (areaIntent === "GOOD_AREA") {
    traits.add(TRAITS.SAFE);
    traits.add(TRAITS.WALKABLE);
    traits.add(TRAITS.UPSCALE_AREA);
  }
  if (areaIntent === "CITY_CENTER") traits.add(TRAITS.CENTRAL);
  if (areaIntent === "QUIET") traits.add(TRAITS.QUIET);
  if (areaIntent === "NIGHTLIFE") traits.add(TRAITS.NIGHTLIFE);
  if (areaIntent === "BEACH_COAST") traits.add(TRAITS.WATERFRONT_AREA);

  areaTraits.forEach((trait) => {
    const normalized = String(trait || "").trim().toUpperCase();
    if (normalized === "SAFE") traits.add(TRAITS.SAFE);
    if (normalized === "WALKABLE") traits.add(TRAITS.WALKABLE);
    if (normalized === "QUIET") traits.add(TRAITS.QUIET);
    if (normalized === "NIGHTLIFE") traits.add(TRAITS.NIGHTLIFE);
    if (normalized === "FAMILY") traits.add(TRAITS.FAMILY);
    if (normalized === "LUXURY") traits.add(TRAITS.UPSCALE_AREA);
    if (normalized === "GOOD_AREA") {
      traits.add(TRAITS.SAFE);
      traits.add(TRAITS.WALKABLE);
      traits.add(TRAITS.UPSCALE_AREA);
    }
  });

  if (["RIVER_VIEW", "WATER_VIEW", "SEA_VIEW"].includes(viewIntent)) {
    traits.add(TRAITS.WATERFRONT_AREA);
  }
  if (qualityIntent === "LUXURY") traits.add(TRAITS.UPSCALE_AREA);
  if (detectBusinessSignal(rawText)) traits.add(TRAITS.BUSINESS);
  if (detectCulturalSignal(rawText)) traits.add(TRAITS.CULTURAL);
  if (detectCentralSignal(rawText)) traits.add(TRAITS.CENTRAL);

  return Array.from(traits);
};

const normalizeLockedSemanticUserIntent = (value = null) => {
  if (!value || typeof value !== "object") return null;
  return {
    userRequestedAreaTraits: uniqueUpperList(value.userRequestedAreaTraits),
    userRequestedZones: uniqueList(
      Array.isArray(value.userRequestedZones) ? value.userRequestedZones : [],
    ),
    userRequestedLandmarks: uniqueList(
      Array.isArray(value.userRequestedLandmarks)
        ? value.userRequestedLandmarks
        : [],
    ),
    inferenceMode:
      typeof value.inferenceMode === "string"
        ? value.inferenceMode.trim().toUpperCase() || null
        : null,
  };
};

export const getSemanticCityCatalog = ({ city = null, country = null } = {}) => {
  const cityKey = normalizeSemanticCatalogText(city);
  const countryKey = normalizeSemanticCatalogText(country);
  if (!cityKey) return null;
  if (countryKey) {
    const exact = CITY_CATALOG_BY_KEY.get(`${cityKey}|${countryKey}`);
    if (exact) return exact;
  }
  return CITY_CATALOG_BY_KEY.get(cityKey) || null;
};

export const resolveSemanticCatalogMatches = ({ plan = {}, cityCatalog = null } = {}) => {
  if (!cityCatalog) return { zones: [], landmarks: [] };
  const rawTargets = [
    ...(Array.isArray(plan?.placeTargets) ? plan.placeTargets : []),
    ...(Array.isArray(plan?.semanticSearch?.webContext?.resolvedPlaces)
      ? plan.semanticSearch.webContext.resolvedPlaces
      : []),
  ];
  const zoneMatches = [];
  const landmarkMatches = [];
  const seenZones = new Set();
  const seenLandmarks = new Set();

  rawTargets.forEach((target) => {
    const rawText = target?.normalizedName || target?.rawText || target?.name || null;
    if (!rawText) return;
    cityCatalog.zones.forEach((zone) => {
      if (!seenZones.has(zone.id) && matchCatalogEntityByText(zone, rawText)) {
        seenZones.add(zone.id);
        zoneMatches.push(zone);
      }
    });
    cityCatalog.landmarks.forEach((landmark) => {
      if (!seenLandmarks.has(landmark.id) && matchCatalogEntityByText(landmark, rawText)) {
        seenLandmarks.add(landmark.id);
        landmarkMatches.push(landmark);
      }
    });
  });

  return { zones: zoneMatches, landmarks: landmarkMatches };
};

export const selectCatalogZonesByTraits = ({
  cityCatalog = null,
  requestedAreaTraits = [],
  limit = 8,
} = {}) => {
  if (!cityCatalog || !Array.isArray(cityCatalog.zones) || !cityCatalog.zones.length) {
    return [];
  }
  const requested = uniqueUpperList(requestedAreaTraits);
  if (!requested.length) return [];

  const ranked = cityCatalog.zones
    .map((zone) => {
      const overlap = requested.filter((trait) => zone.traits.includes(trait));
      return { zone, overlapCount: overlap.length };
    })
    .filter((entry) => entry.overlapCount > 0);
  if (!ranked.length) return [];

  const maxOverlap = ranked.reduce(
    (best, entry) => Math.max(best, entry.overlapCount),
    0,
  );
  const minOverlap =
    requested.length <= 1 ? 1 : Math.max(2, Math.max(1, maxOverlap - 1));

  return ranked
    .filter((entry) => entry.overlapCount >= minOverlap)
    .sort((left, right) => {
      if (right.overlapCount !== left.overlapCount) {
        return right.overlapCount - left.overlapCount;
      }
      return left.zone.name.localeCompare(right.zone.name);
    })
    .slice(0, limit)
    .map((entry) => entry.zone);
};

const selectCatalogLandmarksByTraits = ({
  cityCatalog = null,
  requestedAreaTraits = [],
  candidateZones = [],
  limit = 8,
} = {}) => {
  if (
    !cityCatalog ||
    !Array.isArray(cityCatalog.landmarks) ||
    !cityCatalog.landmarks.length
  ) {
    return [];
  }
  const requested = uniqueUpperList(requestedAreaTraits);
  const candidateZoneIds = new Set(
    (Array.isArray(candidateZones) ? candidateZones : [])
      .map((zone) => zone?.id)
      .filter(Boolean),
  );

  return cityCatalog.landmarks
    .map((landmark) => {
      const overlap = requested.filter((trait) =>
        Array.isArray(landmark?.traits)
          ? landmark.traits.includes(trait)
          : false,
      );
      const zoneAffinity = Array.isArray(landmark?.zoneIds)
        ? landmark.zoneIds.some((zoneId) => candidateZoneIds.has(zoneId))
        : false;
      return {
        landmark,
        overlapCount: overlap.length,
        zoneAffinity,
      };
    })
    .filter((entry) => entry.overlapCount > 0 || entry.zoneAffinity)
    .sort((left, right) => {
      if (Number(right.zoneAffinity) !== Number(left.zoneAffinity)) {
        return Number(right.zoneAffinity) - Number(left.zoneAffinity);
      }
      if (right.overlapCount !== left.overlapCount) {
        return right.overlapCount - left.overlapCount;
      }
      return left.landmark.name.localeCompare(right.landmark.name);
    })
    .slice(0, limit)
    .map((entry) => entry.landmark);
};

export const buildSemanticIntentProfile = ({
  plan = {},
  latestUserMessage = "",
} = {}) => {
  const cityCatalog = getSemanticCityCatalog({
    city: plan?.location?.city,
    country: plan?.location?.country,
  });
  const lockedUserIntent = normalizeLockedSemanticUserIntent(
    plan?.semanticSearch?.userIntentLock,
  );
  const requestedAreaTraits =
    lockedUserIntent?.userRequestedAreaTraits?.length ||
    (lockedUserIntent &&
      Array.isArray(lockedUserIntent.userRequestedAreaTraits) &&
      !lockedUserIntent.userRequestedAreaTraits.length)
      ? lockedUserIntent.userRequestedAreaTraits
      : deriveRequestedAreaTraits({ plan, latestUserMessage });
  const matched = resolveSemanticCatalogMatches({ plan, cityCatalog });
  const explicitPlaceTargets = Array.isArray(plan?.placeTargets)
    ? plan.placeTargets.filter(
        (target) =>
          target &&
          typeof target === "object" &&
          (target.rawText || target.normalizedName),
      )
    : [];
  const matchedZoneIds = matched.zones.map((zone) => zone.id);
  const matchedLandmarkIds = matched.landmarks.map((landmark) => landmark.id);
  const userRequestedZones =
    lockedUserIntent &&
    Array.isArray(lockedUserIntent.userRequestedZones) &&
    (lockedUserIntent.userRequestedZones.length || !explicitPlaceTargets.length)
      ? lockedUserIntent.userRequestedZones
      : matchedZoneIds;
  const userRequestedLandmarks =
    lockedUserIntent &&
    Array.isArray(lockedUserIntent.userRequestedLandmarks) &&
    (lockedUserIntent.userRequestedLandmarks.length || !explicitPlaceTargets.length)
      ? lockedUserIntent.userRequestedLandmarks
      : matchedLandmarkIds;

  let candidateZones = [];
  let candidateLandmarks = [];
  let inferenceMode = "NONE";
  let confidence = "LOW";

  if (lockedUserIntent?.inferenceMode === "EXPLICIT_GEO") {
    inferenceMode = "EXPLICIT_GEO";
    confidence =
      userRequestedZones.length || userRequestedLandmarks.length ? "HIGH" : "MEDIUM";
  } else if (userRequestedZones.length || userRequestedLandmarks.length) {
    inferenceMode = "EXPLICIT_GEO";
    confidence = "HIGH";
  } else if (explicitPlaceTargets.length && plan?.geoIntent) {
    inferenceMode = "EXPLICIT_GEO";
    confidence = "MEDIUM";
  } else if (cityCatalog && requestedAreaTraits.length) {
    candidateZones = selectCatalogZonesByTraits({
      cityCatalog,
      requestedAreaTraits,
    });
    candidateLandmarks = selectCatalogLandmarksByTraits({
      cityCatalog,
      requestedAreaTraits,
      candidateZones,
    });
    inferenceMode = "TRAIT_PROFILE";
    confidence = candidateZones.length || candidateLandmarks.length ? "MEDIUM" : "LOW";
  }

  return {
    version: SEMANTIC_INTENT_PROFILE_VERSION,
    userRequestedAreaTraits: requestedAreaTraits,
    userRequestedZones,
    userRequestedLandmarks,
    candidateZones: candidateZones.map((zone) => zone.id),
    candidateLandmarks: candidateLandmarks.map((landmark) => landmark.id),
    inferenceMode,
    requestedAreaTraits,
    requestedZones: userRequestedZones,
    requestedLandmarks: userRequestedLandmarks,
    confidence,
    fallbackMode:
      inferenceMode === "EXPLICIT_GEO" && confidence === "HIGH"
        ? "NONE"
        : "EXPAND_WITH_NOTICE",
    cityProfileVersion: cityCatalog ? SEMANTIC_INTENT_PROFILE_VERSION : null,
  };
};

export const resolveSemanticCatalogContext = ({ plan = {} } = {}) => {
  const cityCatalog = getSemanticCityCatalog({
    city: plan?.location?.city,
    country: plan?.location?.country,
  });
  const profile =
    plan?.semanticSearch?.intentProfile &&
    typeof plan.semanticSearch.intentProfile === "object"
      ? plan.semanticSearch.intentProfile
      : buildSemanticIntentProfile({ plan });
  const matched = resolveSemanticCatalogMatches({ plan, cityCatalog });
  const explicitZoneIds =
    Array.isArray(profile?.userRequestedZones) && profile.userRequestedZones.length
      ? profile.userRequestedZones
      : matched.zones.map((zone) => zone.id);
  const explicitLandmarkIds =
    Array.isArray(profile?.userRequestedLandmarks) &&
    profile.userRequestedLandmarks.length
      ? profile.userRequestedLandmarks
      : matched.landmarks.map((landmark) => landmark.id);
  const explicitZones =
    Array.isArray(cityCatalog?.zones) && explicitZoneIds.length
      ? cityCatalog.zones.filter((zone) => explicitZoneIds.includes(zone.id))
      : matched.zones;
  const explicitLandmarks =
    Array.isArray(cityCatalog?.landmarks) && explicitLandmarkIds.length
      ? cityCatalog.landmarks.filter((landmark) =>
          explicitLandmarkIds.includes(landmark.id),
        )
      : matched.landmarks;
  const candidateZones =
    Array.isArray(cityCatalog?.zones) && Array.isArray(profile?.candidateZones)
      ? cityCatalog.zones.filter((zone) => profile.candidateZones.includes(zone.id))
      : selectCatalogZonesByTraits({
          cityCatalog,
          requestedAreaTraits:
            profile.userRequestedAreaTraits || profile.requestedAreaTraits,
        });
  const candidateLandmarks =
    Array.isArray(cityCatalog?.landmarks) && Array.isArray(profile?.candidateLandmarks)
      ? cityCatalog.landmarks.filter((landmark) =>
          profile.candidateLandmarks.includes(landmark.id),
        )
      : selectCatalogLandmarksByTraits({
          cityCatalog,
          requestedAreaTraits:
            profile.userRequestedAreaTraits || profile.requestedAreaTraits,
          candidateZones,
        });

  return {
    cityCatalog,
    profile,
    mode: profile?.inferenceMode || "NONE",
    explicitZones,
    explicitLandmarks,
    candidateZones,
    candidateLandmarks,
  };
};
