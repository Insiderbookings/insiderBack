// seeds/miami-bookings-seed.js
// Crea hosts, homes y bookings extra en el área de Miami sin tocar otros datos.
// Ejecutar: node seeds/miami-bookings-seed.js

import bcrypt from "bcrypt";
import models, { sequelize } from "../src/models/index.js";

const LOCATIONS = [
  { city: "Miami", country: "USA", baseLat: 25.7617, baseLng: -80.1918 },
  { city: "Miami Beach", country: "USA", baseLat: 25.7907, baseLng: -80.1300 },
  { city: "Fort Lauderdale", country: "USA", baseLat: 26.1224, baseLng: -80.1373 },
  { city: "Hollywood", country: "USA", baseLat: 26.0112, baseLng: -80.1495 },
];

const HOST_EMAILS = [
  "miami_host1@dev.local",
  "miami_host2@dev.local",
  "miami_host3@dev.local",
  "miami_host4@dev.local",
];

const TRAVELER_EMAIL = "miami_traveler@dev.local";

const makeTitle = (city, idx) => `Miami Seed Home ${city} #${idx + 1}`;
const jitter = (val) => (Math.random() - 0.5) * val;

async function ensureTraveler(passwordHash, tx) {
  const [traveler] = await models.User.findOrCreate({
    where: { email: TRAVELER_EMAIL },
    defaults: {
      name: "Miami Traveler",
      email: TRAVELER_EMAIL,
      password_hash: passwordHash,
      role: 0,
    },
    transaction: tx,
    validate: false,
  });
  return traveler;
}

async function ensureHosts(passwordHash, tx) {
  const hosts = [];
  for (const email of HOST_EMAILS) {
    const [host] = await models.User.findOrCreate({
      where: { email },
      defaults: { name: email.split("@")[0], email, password_hash: passwordHash, role: 6 },
      transaction: tx,
      validate: false,
    });
    hosts.push(host);
    await models.HostProfile.findOrCreate({
      where: { user_id: host.id },
      defaults: { user_id: host.id, metadata: { bio: "Miami host" } },
      transaction: tx,
    });
  }
  return hosts;
}

async function createHomes(hosts, tx) {
  const homes = [];
  let counter = 0;
  for (const loc of LOCATIONS) {
    for (let i = 0; i < 3; i += 1) {
      const host = hosts[counter % hosts.length];
      const title = makeTitle(loc.city, i);
      const existing = await models.Home.findOne({ where: { title }, transaction: tx });
      if (existing) {
        homes.push(existing);
        counter += 1;
        continue;
      }
      const home = await models.Home.create(
        {
          host_id: host.id,
          title,
          description: "Sample Miami area home",
          status: "PUBLISHED",
          is_visible: true,
          property_type: "HOUSE",
          space_type: "ENTIRE_PLACE",
          max_guests: 4,
          bedrooms: 2,
          beds: 2,
          bathrooms: 1,
          marketing_tags: ["featured"],
          draft_step: 20,
        },
        { transaction: tx, validate: false },
      );
      await models.HomeAddress.create(
        {
          home_id: home.id,
          address_line1: `Seed St ${counter + 1}`,
          city: loc.city,
          country: loc.country,
          state: loc.city,
          latitude: (loc.baseLat || 0) + jitter(0.05),
          longitude: (loc.baseLng || 0) + jitter(0.05),
        },
        { transaction: tx, validate: false },
      );
      await models.HomePricing.create(
        {
          home_id: home.id,
          currency: "USD",
          base_price: 180 + (i % 3) * 20,
          weekend_price: 220 + (i % 3) * 20,
          cleaning_fee: 40,
        },
        { transaction: tx, validate: false },
      );
      await models.HomeMedia.create(
        {
          home_id: home.id,
          url: `https://picsum.photos/seed/miamihome${home.id}/800/600`,
          is_cover: true,
          order: 0,
        },
        { transaction: tx, validate: false },
      );
      homes.push(home);
      counter += 1;
    }
  }
  return homes;
}

const bookingKey = (userId, homeId, checkIn, checkOut) => `HOME|${userId}|${homeId}|${checkIn}|${checkOut}`;

async function createBookings({ homes, traveler, tx }) {
  const existingKeys = new Set();
  const existing = await models.Booking.findAll({
    attributes: ["user_id", "inventory_id", "check_in", "check_out"],
    where: { inventory_type: "HOME" },
    transaction: tx,
    raw: true,
  });
  existing.forEach((b) => existingKeys.add(bookingKey(b.user_id, b.inventory_id, b.check_in, b.check_out)));

  const today = new Date();
  const addDays = (d, days) => {
    const copy = new Date(d.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy.toISOString().slice(0, 10);
  };

  const payloads = [];
  homes.forEach((home, idx) => {
    const checkIn = addDays(today, 3 + idx);
    const checkOut = addDays(today, 5 + idx);
    const key = bookingKey(traveler.id, home.id, checkIn, checkOut);
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    payloads.push({
      user_id: traveler.id,
      source: "HOME",
      inventory_type: "HOME",
      inventory_id: String(home.id),
      check_in: checkIn,
      check_out: checkOut,
      nights: 2,
      guest_name: traveler.name,
      guest_email: traveler.email,
      guest_phone: null,
      adults: 2,
      children: 0,
      status: "COMPLETED",
      payment_status: "PAID",
      gross_price: 520 + (idx % 4) * 25,
      currency: "USD",
      booking_latitude: home?.address?.latitude ?? null,
      booking_longitude: home?.address?.longitude ?? null,
    });
  });

  const created = payloads.length
    ? await models.Booking.bulkCreate(payloads, { transaction: tx, validate: false })
    : [];

  for (const booking of created) {
    const homeId = Number(booking.inventory_id);
    if (!Number.isFinite(homeId)) continue;
    const home = homes.find((h) => h.id === homeId);
    if (!home) continue;
    const existingStay = await models.StayHome.findOne({
      where: { stay_id: booking.id, home_id: home.id },
      transaction: tx,
    });
    if (!existingStay) {
      await models.StayHome.create(
        { stay_id: booking.id, home_id: home.id, host_id: home.host_id },
        { transaction: tx },
      );
    }
  }
}

async function main() {
  await sequelize.authenticate();
  const tx = await sequelize.transaction();
  try {
    const passwordHash = await bcrypt.hash("123456", 10);
    const traveler = await ensureTraveler(passwordHash, tx);
    const hosts = await ensureHosts(passwordHash, tx);
    const homes = await createHomes(hosts, tx);
    await createBookings({ homes, traveler, tx });
    await tx.commit();
    console.log("Miami seed OK");
  } catch (err) {
    console.error("Miami seed failed", err);
    await sequelize.close();
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
