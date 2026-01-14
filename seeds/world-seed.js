// seeds/world-seed.js
// Ejecutar: node seeds/world-seed.js

import "dotenv/config";
import bcrypt from "bcrypt";
import models, { sequelize } from "../src/models/index.js";
import { linkReferralCodeForUser } from "../src/services/referralRewards.service.js";

const PASSWORD = process.env.SEED_PASSWORD || "123456";
const LISTINGS_PER_CITY = Number(process.env.SEED_LISTINGS_PER_CITY || 4);
const MEDIA_PER_HOME = Number(process.env.SEED_MEDIA_PER_HOME || 4);

const ALLOWED_MEDIA_HOSTS = new Set(["upload.wikimedia.org"]);

const CITY_CATALOG = [
  { city: "Buenos Aires", country: "Argentina", baseLat: -34.6037, baseLng: -58.3816 },
  { city: "London", country: "United Kingdom", baseLat: 51.5074, baseLng: -0.1278 },
  { city: "Rome", country: "Italy", baseLat: 41.9028, baseLng: 12.4964 },
  { city: "Paris", country: "France", baseLat: 48.8566, baseLng: 2.3522 },
  { city: "Miami", country: "USA", baseLat: 25.7617, baseLng: -80.1918 },
  { city: "New York", country: "USA", baseLat: 40.7128, baseLng: -74.006 },
  { city: "Dubai", country: "United Arab Emirates", baseLat: 25.2048, baseLng: 55.2708 },
  { city: "Tokyo", country: "Japan", baseLat: 35.6895, baseLng: 139.6917 },
  { city: "Barcelona", country: "Spain", baseLat: 41.3851, baseLng: 2.1734 },
  { city: "Mexico City", country: "Mexico", baseLat: 19.4326, baseLng: -99.1332 },
  { city: "Sydney", country: "Australia", baseLat: -33.8688, baseLng: 151.2093 },
];

const CITY_MEDIA = {
  "Buenos Aires": [
    "https://upload.wikimedia.org/wikipedia/commons/d/da/60-hotel-plaza.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/7/78/Buenos_Aires_Jousten_Hotel_1.jpg",
  ],
  London: [
    "https://upload.wikimedia.org/wikipedia/commons/e/e0/Hotel_Russell_on_Russell_Square%2C_London_-_April_2007.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/9/97/St._Pancras_Renaissance_London_Hotel_-_panoramio_%281%29_cropped.jpg",
  ],
  Rome: [
    "https://upload.wikimedia.org/wikipedia/commons/9/90/Excelsior_Hotel_Rome_2_%285277902009%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/b/ba/Hotel_Majestic_in_Rome.jpg",
  ],
  Paris: [
    "https://upload.wikimedia.org/wikipedia/commons/7/73/Exterior_of_the_H%C3%B4tel_Ritz_Paris.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/3/3b/Paris_Napoleon_Hotel_Outside_building.jpg",
  ],
  Miami: [
    "https://upload.wikimedia.org/wikipedia/commons/b/bb/Mandarin_Oriental_Miami_exterior_day.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/c/c7/Eden_Roc_exterior_FL1.jpg",
  ],
  "New York": [
    "https://upload.wikimedia.org/wikipedia/commons/c/c2/Arthouse_Hotel_New_York_City_HDR_2022_jeh.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/3/3c/Plaza_Hotel_%28New_York_City%29-20090519-RM-122823.jpg",
  ],
  Dubai: [
    "https://upload.wikimedia.org/wikipedia/commons/f/fd/BURJ_AL_ARAB%2C_MOST_LUXURIOUS_HOTEL_IN_THE_WORLD%2C_APRIL_2012_-_panoramio.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/2/28/Hyatt_Regency_Dubai_-_Exterior.jpg",
  ],
  Tokyo: [
    "https://upload.wikimedia.org/wikipedia/commons/8/8d/CAPSULE_HOTEL%2C_TOKYO.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/d/d9/Mandarin_Oriental_Exterior_Tokyo.jpg",
  ],
  Barcelona: [
    "https://upload.wikimedia.org/wikipedia/commons/4/45/Barcelona_-_Hotel_W_Barcelona_%2801%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/f/f6/Expo_Hotel%2C_Barcelona_%28P1170736%29.jpg",
  ],
  "Mexico City": [
    "https://upload.wikimedia.org/wikipedia/commons/4/4f/Hotel_Geneve%2C_Mexico_D.F._-_panoramio.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/f/f4/Hotel_InterContinental_Presidente_Mexico_City_2025_06.jpg",
  ],
  Sydney: [
    "https://upload.wikimedia.org/wikipedia/commons/8/8a/Adina_Apartment_Hotel_Sydney_Town_Hall_in_Sydney_CBD_August_2025.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/f/f8/Sydney_%28AU%29%2C_George_Street%2C_The_Fullerton_Hotel_Sydney_--_2019_--_3574.jpg",
  ],
};

const INTERIOR_MEDIA = [
  "https://upload.wikimedia.org/wikipedia/commons/e/e6/Apartment%2C_interior_detail._Architect_Andrey_Kurochkin._Saint_Petersburg.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/0/04/Apartment_Interior_Moscow_1964.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/7/73/Bathroom%2C_Interior_of_apartment_in_Brisbane%2C_2025%2C_07.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/5/5d/Bedroom%2C_Interior_of_apartment_in_Brisbane%2C_2025%2C_01.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/2/2a/Bedroom%2C_Interior_of_apartment_in_Brisbane%2C_2025%2C_02.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/3/35/Dinning%2C_Interior_of_apartment_in_Brisbane%2C_2025%2C_04.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/8/8a/Kitchen%2C_Interior_of_apartment_in_Brisbane%2C_2025%2C_03.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/8/8a/Lounge%2C_Interior_of_apartment_in_Brisbane%2C_2025%2C.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/b/b7/Hotel_room_interior_at_hotel_Radisson_Blu_Oulu.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/c/c6/Interior_of_a_room_at_City_Lodge_OR_Tambo_Airport_hotel_February_2025.jpg",
];

const ensureAllowedMedia = (url) => {
  const parsed = new URL(url);
  if (!ALLOWED_MEDIA_HOSTS.has(parsed.hostname)) {
    throw new Error(`Media host not allowed: ${parsed.hostname}`);
  }
  return url;
};

const unique = (items) => Array.from(new Set(items));

const toPlain = (value) => {
  if (!value) return null;
  if (typeof value.toJSON === "function") {
    try {
      return value.toJSON();
    } catch {
      return value;
    }
  }
  return value;
};

const buildLocationText = (address) => {
  if (!address) return null;
  const parts = [
    address.address_line1,
    address.city,
    address.state,
    address.country,
  ]
    .map((part) => (part ? String(part).trim() : null))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

const pickCoverFromMedia = (media) => {
  if (!Array.isArray(media) || !media.length) return null;
  const normalized = media.map(toPlain);
  const cover =
    normalized.find((item) => item?.is_cover) ??
    normalized.find((item) => Number(item?.order) === 0) ??
    normalized[0];
  return cover?.url ?? null;
};

const buildHomeSnapshot = ({ home, address, media }) => {
  const homePlain = toPlain(home) ?? {};
  const addressPlain = toPlain(address);
  const mediaPlain = Array.isArray(media) ? media.map(toPlain) : [];
  const locationText = buildLocationText(addressPlain);
  const coverImage = pickCoverFromMedia(mediaPlain);
  const photos = mediaPlain.map((item) => item?.url).filter(Boolean);
  const addressPayload = addressPlain
    ? {
        address_line1: addressPlain.address_line1 ?? null,
        city: addressPlain.city ?? null,
        state: addressPlain.state ?? null,
        country: addressPlain.country ?? null,
        latitude: addressPlain.latitude ?? null,
        longitude: addressPlain.longitude ?? null,
      }
    : null;

  return {
    homeId: homePlain.id ?? null,
    title: homePlain.title ?? null,
    coverImage: coverImage ?? null,
    photos,
    location: locationText ?? null,
    city: addressPlain?.city ?? null,
    country: addressPlain?.country ?? null,
    address: addressPayload,
    home: {
      id: homePlain.id ?? null,
      title: homePlain.title ?? null,
      coverImage: coverImage ?? null,
      photos,
      address: addressPayload,
      locationText,
      stats: {
        maxGuests: homePlain.max_guests ?? null,
        bedrooms: homePlain.bedrooms ?? null,
        beds: homePlain.beds ?? null,
        bathrooms:
          homePlain.bathrooms != null ? Number(homePlain.bathrooms) : null,
      },
      propertyType: homePlain.property_type ?? null,
      spaceType: homePlain.space_type ?? null,
    },
  };
};

const pickMediaForHome = (city, index) => {
  const cityMedia = CITY_MEDIA[city] || [];
  const cover = cityMedia[index % cityMedia.length] || INTERIOR_MEDIA[index % INTERIOR_MEDIA.length];
  const media = [cover];
  let cursor = index;
  while (media.length < MEDIA_PER_HOME) {
    const next = INTERIOR_MEDIA[cursor % INTERIOR_MEDIA.length];
    if (!media.includes(next)) media.push(next);
    cursor += 1;
    if (cursor - index > INTERIOR_MEDIA.length + 2) break;
  }
  return media;
};

const addDays = (base, days) => {
  const copy = new Date(base.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

async function main() {
  await sequelize.authenticate();
  const tx = await sequelize.transaction();
  try {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const allMedia = unique([
      ...Object.values(CITY_MEDIA).flat(),
      ...INTERIOR_MEDIA,
    ]);
    allMedia.forEach(ensureAllowedMedia);

    const travelerPayload = Array.from({ length: 24 }).map((_, i) => ({
      name: `Traveler ${i + 1}`,
      email: `traveler${String(i + 1).padStart(2, "0")}@seed.local`,
      password_hash: passwordHash,
      role: 0,
      is_active: true,
    }));
    const hostPayload = Array.from({ length: 18 }).map((_, i) => ({
      name: `Host ${i + 1}`,
      email: `host${String(i + 1).padStart(2, "0")}@seed.local`,
      password_hash: passwordHash,
      role: 6,
      is_active: true,
    }));
    const influencerPayload = Array.from({ length: 6 }).map((_, i) => ({
      name: `Influencer ${i + 1}`,
      email: `influencer${String(i + 1).padStart(2, "0")}@seed.local`,
      password_hash: passwordHash,
      role: 2,
      user_code: `INF${String(i + 1).padStart(2, "0")}`,
      is_active: true,
    }));
    const userPayload = Array.from({ length: 6 }).map((_, i) => ({
      name: `User ${i + 1}`,
      email: `user${String(i + 1).padStart(2, "0")}@seed.local`,
      password_hash: passwordHash,
      role: 0,
      is_active: true,
    }));

    await models.User.bulkCreate(travelerPayload, {
      transaction: tx,
      validate: false,
      ignoreDuplicates: true,
    });
    await models.User.bulkCreate(hostPayload, {
      transaction: tx,
      validate: false,
      ignoreDuplicates: true,
    });
    await models.User.bulkCreate(influencerPayload, {
      transaction: tx,
      validate: false,
      ignoreDuplicates: true,
    });
    await models.User.bulkCreate(userPayload, {
      transaction: tx,
      validate: false,
      ignoreDuplicates: true,
    });

    const travelers = await models.User.findAll({
      where: { email: travelerPayload.map((u) => u.email) },
      transaction: tx,
    });
    const hosts = await models.User.findAll({
      where: { email: hostPayload.map((u) => u.email) },
      transaction: tx,
    });
    const influencers = await models.User.findAll({
      where: { email: influencerPayload.map((u) => u.email) },
      transaction: tx,
    });

    for (const influencer of influencers) {
      if (!influencer.user_code) {
        const code = `INF${String(influencer.id).padStart(2, "0")}`;
        await influencer.update({ user_code: code }, { transaction: tx });
      }
      if (models.CouponWallet) {
        await models.CouponWallet.findOrCreate({
          where: { influencer_user_id: influencer.id },
          defaults: { total_granted: 20, total_used: 0 },
          transaction: tx,
        });
      }
    }

    if (models.GuestProfile) {
      for (const traveler of travelers) {
        await models.GuestProfile.findOrCreate({
          where: { user_id: traveler.id },
          defaults: { user_id: traveler.id, bio: "Seed traveler" },
          transaction: tx,
        });
      }
    }

    if (models.HostProfile) {
      for (const host of hosts) {
        await models.HostProfile.findOrCreate({
          where: { user_id: host.id },
          defaults: { user_id: host.id, metadata: { bio: "Seed host" } },
          transaction: tx,
        });
      }
    }

    const referableTravelers = travelers.filter((t) => !t.referred_by_influencer_id);
    for (let i = 0; i < referableTravelers.length; i++) {
      const traveler = referableTravelers[i];
      const influencer = influencers[i % influencers.length];
      if (!influencer || !influencer.user_code) continue;
      try {
        await linkReferralCodeForUser({
          userId: traveler.id,
          referralCode: influencer.user_code,
          transaction: tx,
        });
      } catch (err) {
        if (!String(err?.message || "").includes("already")) throw err;
      }
    }

    const amenityIconMap = {
      WIFI: "wifi-outline",
      AC: "snow-outline",
      KITCHEN: "restaurant-outline",
      WASHER: "refresh-outline",
      TV: "tv-outline",
    };
    const amenityPayload = [
      { name: "Wifi", group_key: "BASICS", amenity_key: "WIFI", label: "Wifi" },
      { name: "A/C", group_key: "BASICS", amenity_key: "AC", label: "Air conditioning" },
      { name: "Kitchen", group_key: "BASICS", amenity_key: "KITCHEN", label: "Kitchen" },
      { name: "Washer", group_key: "BASICS", amenity_key: "WASHER", label: "Washer" },
      { name: "TV", group_key: "BASICS", amenity_key: "TV", label: "TV" },
    ].map((item) => ({ ...item, icon: amenityIconMap[item.amenity_key] || "sparkles-outline" }));

    const amenityCatalog = [];
    for (const payload of amenityPayload) {
      const [row] = await models.HomeAmenity.findOrCreate({
        where: { amenity_key: payload.amenity_key },
        defaults: payload,
        transaction: tx,
      });
      amenityCatalog.push(row);
    }

    const tagPayload = [
      { name: "City", tag_key: "CITY", label: "City" },
      { name: "Business", tag_key: "BUSINESS", label: "Business" },
      { name: "Luxury", tag_key: "LUXURY", label: "Luxury" },
      { name: "Family", tag_key: "FAMILY", label: "Family" },
    ];
    const tagCatalog = [];
    for (const payload of tagPayload) {
      const [row] = await models.HomeTag.findOrCreate({
        where: { tag_key: payload.tag_key },
        defaults: payload,
        transaction: tx,
      });
      tagCatalog.push(row);
    }

    const homesPayload = [];
    for (let c = 0; c < CITY_CATALOG.length; c++) {
      const loc = CITY_CATALOG[c];
      for (let j = 0; j < LISTINGS_PER_CITY; j++) {
        const idx = c * LISTINGS_PER_CITY + j;
        const host = hosts[idx % hosts.length];
        homesPayload.push({
          host_id: host.id,
          title: `World Stay ${loc.city} #${j + 1}`,
          description: `Seed listing in ${loc.city}.`,
          status: "PUBLISHED",
          is_visible: true,
          property_type: "APARTMENT",
          space_type: "ENTIRE_PLACE",
          max_guests: 2 + (j % 4),
          bedrooms: 1 + (j % 3),
          beds: 1 + (j % 3),
          bathrooms: 1,
          marketing_tags: ["seed", "featured"],
          draft_step: 20,
          __loc: loc,
        });
      }
    }

    const existingHomes = await models.Home.findAll({
      where: { title: homesPayload.map((h) => h.title) },
      transaction: tx,
    });
    const existingHomeMap = new Map(existingHomes.map((h) => [h.title, h]));
    const homesToCreate = homesPayload.filter((h) => !existingHomeMap.has(h.title));
    if (homesToCreate.length) {
      await models.Home.bulkCreate(homesToCreate, { transaction: tx, validate: false });
    }

    let homes = await models.Home.findAll({
      where: { title: homesPayload.map((h) => h.title) },
      transaction: tx,
    });
    homes = homes.map((home) => {
      const idx = Number(home.title.split("#")[1]) - 1;
      const locIndex = homesPayload.findIndex((h) => h.title === home.title);
      const loc = homesPayload[locIndex]?.__loc || CITY_CATALOG[idx % CITY_CATALOG.length];
      return Object.assign(home, { __loc: loc });
    });

    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      const loc = home.__loc || CITY_CATALOG[i % CITY_CATALOG.length];
      const jitter = (val) => (Math.random() - 0.5) * val;

      await models.HomeAddress.findOrCreate({
        where: { home_id: home.id },
        defaults: {
          home_id: home.id,
          address_line1: `Seed St ${i + 1}`,
          city: loc.city,
          country: loc.country,
          state: loc.city,
          latitude: (loc.baseLat || 0) + jitter(0.05),
          longitude: (loc.baseLng || 0) + jitter(0.05),
        },
        transaction: tx,
        validate: false,
      });

      await models.HomePricing.findOrCreate({
        where: { home_id: home.id },
        defaults: {
          home_id: home.id,
          currency: "USD",
          base_price: 140 + (i % 6) * 15,
          weekend_price: 180 + (i % 6) * 15,
          cleaning_fee: 35,
        },
        transaction: tx,
        validate: false,
      });

      const mediaCount = await models.HomeMedia.count({
        where: { home_id: home.id },
        transaction: tx,
      });
      if (!mediaCount) {
        const mediaUrls = pickMediaForHome(loc.city, i);
        const rows = mediaUrls.map((url, idx) => ({
          home_id: home.id,
          url,
          is_cover: idx === 0,
          order: idx,
        }));
        await models.HomeMedia.bulkCreate(rows, { transaction: tx, validate: false });
      }

      for (let a = 0; a < 3 && a < amenityCatalog.length; a++) {
        await models.HomeAmenityLink.findOrCreate({
          where: { home_id: home.id, amenity_id: amenityCatalog[a].id },
          defaults: { home_id: home.id, amenity_id: amenityCatalog[a].id },
          transaction: tx,
          validate: false,
        });
      }

      for (let t = 0; t < 2 && t < tagCatalog.length; t++) {
        await models.HomeTagLink.findOrCreate({
          where: { home_id: home.id, tag_id: tagCatalog[t].id },
          defaults: { home_id: home.id, tag_id: tagCatalog[t].id },
          transaction: tx,
          validate: false,
        });
      }
  }

    const homeAddresses = await models.HomeAddress.findAll({
      where: { home_id: homes.map((home) => home.id) },
      transaction: tx,
    });
    const homeMedia = await models.HomeMedia.findAll({
      where: { home_id: homes.map((home) => home.id) },
      transaction: tx,
    });
    const addressByHomeId = new Map(
      homeAddresses.map((address) => [address.home_id, address]),
    );
    const mediaByHomeId = new Map();
    for (const media of homeMedia) {
      const list = mediaByHomeId.get(media.home_id) || [];
      list.push(media);
      mediaByHomeId.set(media.home_id, list);
    }
    for (const [homeId, list] of mediaByHomeId.entries()) {
      list.sort((a, b) => {
        const orderA = Number.isFinite(Number(a?.order)) ? Number(a.order) : 9999;
        const orderB = Number.isFinite(Number(b?.order)) ? Number(b.order) : 9999;
        return orderA - orderB;
      });
      mediaByHomeId.set(homeId, list);
    }
    const homeSnapshots = new Map();
    for (const home of homes) {
      homeSnapshots.set(
        home.id,
        buildHomeSnapshot({
          home,
          address: addressByHomeId.get(home.id) ?? null,
          media: mediaByHomeId.get(home.id) ?? [],
        }),
      );
    }

    const existingHomeBookings = await models.Booking.findAll({
      attributes: ["user_id", "inventory_id", "check_in", "check_out"],
      where: { inventory_type: "HOME" },
      transaction: tx,
      raw: true,
    });
    const existingHomeBookingKeys = new Set(
      existingHomeBookings.map(
        (b) => `HOME|${b.user_id}|${b.inventory_id}|${b.check_in}|${b.check_out}`,
      ),
    );
    const now = new Date();
    const bookingsPayload = [];

    const pushHomeBooking = ({
      home,
      traveler,
      nights,
      startOffsetDays,
      status,
      paymentStatus,
      influencerId,
      priceBase,
      homeSnapshot,
    }) => {
      const checkIn = addDays(now, startOffsetDays);
      const checkOut = addDays(checkIn, nights);
      const key = `HOME|${traveler.id}|${home.id}|${checkIn.toISOString().slice(0, 10)}|${checkOut
        .toISOString()
        .slice(0, 10)}`;
      if (existingHomeBookingKeys.has(key)) return;
      existingHomeBookingKeys.add(key);
      bookingsPayload.push({
        user_id: traveler.id,
        influencer_user_id: influencerId || null,
        source: "HOME",
        inventory_type: "HOME",
        inventory_id: String(home.id),
        check_in: checkIn.toISOString().slice(0, 10),
        check_out: checkOut.toISOString().slice(0, 10),
        nights,
        guest_name: traveler.name,
        guest_email: traveler.email,
        guest_phone: null,
        adults: 2,
        children: 0,
        status,
        payment_status: paymentStatus,
        gross_price: priceBase,
        currency: "USD",
        booked_at: addDays(checkIn, -10),
        inventory_snapshot: homeSnapshot ?? null,
      });
    };

    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      const travelerPast = travelers[i % travelers.length];
      const travelerFuture = travelers[(i + 7) % travelers.length];
      const influencer = influencers.length && i % 4 === 0 ? influencers[i % influencers.length] : null;
      const homeSnapshot = homeSnapshots.get(home.id) ?? null;

      pushHomeBooking({
        home,
        traveler: travelerPast,
        nights: 3 + (i % 3),
        startOffsetDays: -30 - (i % 12),
        status: "COMPLETED",
        paymentStatus: "PAID",
        influencerId: influencer?.id || null,
        priceBase: 520 + (i % 5) * 25,
        homeSnapshot,
      });

      pushHomeBooking({
        home,
        traveler: travelerFuture,
        nights: 2 + (i % 4),
        startOffsetDays: 14 + (i % 12),
        status: "CONFIRMED",
        paymentStatus: "PENDING",
        influencerId: influencer?.id || null,
        priceBase: 480 + (i % 5) * 20,
        homeSnapshot,
      });
    }

    if (bookingsPayload.length) {
      await models.Booking.bulkCreate(bookingsPayload, {
        transaction: tx,
        validate: false,
      });
    }

    const bookingRows = await models.Booking.findAll({
      where: { inventory_type: "HOME", inventory_id: homes.map((home) => String(home.id)) },
      transaction: tx,
    });

    for (const booking of bookingRows) {
      const homeId = Number(booking.inventory_id);
      if (!Number.isFinite(homeId)) continue;
      const home = homes.find((h) => h.id === homeId);
      if (!home) continue;

      const snapshot = homeSnapshots.get(homeId) ?? null;
      const existingSnapshot = booking.inventory_snapshot ?? booking.inventorySnapshot ?? null;
      const hasHomeSnapshot =
        existingSnapshot?.home ||
        existingSnapshot?.homeId != null ||
        existingSnapshot?.home_id != null ||
        existingSnapshot?.title ||
        existingSnapshot?.coverImage ||
        Array.isArray(existingSnapshot?.photos);
      if (snapshot && !hasHomeSnapshot) {
        await booking.update(
          { inventory_snapshot: snapshot },
          { transaction: tx },
        );
      }

      const stayExists = await models.StayHome.findOne({
        where: { stay_id: booking.id, home_id: home.id },
        transaction: tx,
      });
      if (stayExists) continue;
      await models.StayHome.create(
        { stay_id: booking.id, home_id: home.id, host_id: home.host_id },
        { transaction: tx },
      );
    }

    for (const booking of bookingRows) {
      const homeId = Number(booking.inventory_id);
      if (!Number.isFinite(homeId)) continue;
      const home = homes.find((h) => h.id === homeId);
      if (!home) continue;

      const snapshot = homeSnapshots.get(homeId) ?? null;
      const snapshotHome = snapshot?.home ?? null;
      const snapshotName =
        snapshotHome?.title ?? snapshot?.title ?? home.title ?? null;
      const snapshotImage =
        snapshotHome?.coverImage ?? snapshot?.coverImage ?? null;

      const [thread] = await models.ChatThread.findOrCreate({
        where: {
          guest_user_id: booking.user_id,
          host_user_id: home.host_id,
          reserve_id: booking.id,
          home_id: homeId,
        },
        defaults: {
          guest_user_id: booking.user_id,
          host_user_id: home.host_id,
          reserve_id: booking.id,
          home_id: homeId,
          status: "OPEN",
          check_in: booking.check_in,
          check_out: booking.check_out,
          home_snapshot_name: snapshotName,
          home_snapshot_image: snapshotImage,
          last_message_at: new Date(),
        },
        transaction: tx,
      });

      const threadUpdates = {};
      if (!thread.home_snapshot_name && snapshotName) {
        threadUpdates.home_snapshot_name = snapshotName;
      }
      if (!thread.home_snapshot_image && snapshotImage) {
        threadUpdates.home_snapshot_image = snapshotImage;
      }
      if (!thread.check_in && booking.check_in) {
        threadUpdates.check_in = booking.check_in;
      }
      if (!thread.check_out && booking.check_out) {
        threadUpdates.check_out = booking.check_out;
      }
      if (Object.keys(threadUpdates).length) {
        await thread.update(threadUpdates, { transaction: tx });
      }

      const participantRows = [
        { user_id: booking.user_id, role: "GUEST" },
        { user_id: home.host_id, role: "HOST" },
      ];
      for (const participant of participantRows) {
        await models.ChatParticipant.findOrCreate({
          where: { chat_id: thread.id, user_id: participant.user_id },
          defaults: {
            chat_id: thread.id,
            user_id: participant.user_id,
            role: participant.role,
          },
          transaction: tx,
        });
      }
    }

    await tx.commit();
    console.log("World seed OK");
  } catch (err) {
    console.error("World seed failed", err);
    await tx.rollback();
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
