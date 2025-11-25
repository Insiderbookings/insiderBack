// seeds/dev-seed.js
// Pobla entorno dev con usuarios, hosts, hoteles/rooms, homes y bookings de ejemplo.
// Ejecutar: node seeds/dev-seed.js

import models, { sequelize } from "../src/models/index.js";
import bcrypt from "bcrypt";

async function main() {
  await sequelize.authenticate();
  const tx = await sequelize.transaction();
  try {
    const passwordHash = await bcrypt.hash("123456", 10);

    // IMPORTANT: non-destructive mode — only inserts new sample data.
    // No TRUNCATE/DELETE here to allow safe execution in shared environments.

    // 5 viajeros
    const travelers = await models.User.bulkCreate(
      Array.from({ length: 5 }).map((_, i) => ({
        name: `Traveler ${i + 1}`,
        email: `trav${i + 1}@dev.local`,
        password_hash: passwordHash,
        role: 0, // traveler
      })),
      { transaction: tx, validate: false }
    );

    // 10 hosts + profiles
    const hosts = await models.User.bulkCreate(
      Array.from({ length: 10 }).map((_, i) => ({
        name: `Host ${i + 1}`,
        email: `host${i + 1}@dev.local`,
        password_hash: passwordHash,
        role: 6, // host/operator-ish
      })),
      { transaction: tx, validate: false }
    );
    await models.HostProfile.bulkCreate(
      hosts.map((h) => ({ user_id: h.id, metadata: { bio: "Dev host" } })),
      { transaction: tx, validate: false }
    );

    // Hoteles y rooms
    const hotels = await models.Hotel.bulkCreate(
      Array.from({ length: 3 }).map((_, i) => ({
        name: `Dev Hotel ${i + 1}`,
        city: "Test City",
        country: "Testland",
        address: `Street ${i + 1}`,
      })),
      { transaction: tx, validate: false }
    );
    const rooms = [];
    for (const hotel of hotels) {
      const created = await models.Room.bulkCreate(
        [
          {
            hotel_id: hotel.id,
            room_number: "101",
            name: "Std",
            price: 100,
            capacity: 2,
            beds: "1",
            available: 1,
            suite: false,
            amenities: [],
          },
          {
            hotel_id: hotel.id,
            room_number: "201",
            name: "Deluxe",
            price: 150,
            capacity: 3,
            beds: "2",
            available: 1,
            suite: false,
            amenities: [],
          },
        ],
        { transaction: tx, validate: false }
      );
      rooms.push(...created);
    }

    // Homes publicados
    const homeLocations = [
      // CABA y cercanías
      { city: "Buenos Aires", country: "Argentina", baseLat: -34.61, baseLng: -58.42 },
      { city: "Moreno", country: "Argentina", baseLat: -34.65, baseLng: -58.79 },
      // Miami y cercanías
      { city: "Miami", country: "USA", baseLat: 25.76, baseLng: -80.19 },
      { city: "Miami Beach", country: "USA", baseLat: 25.79, baseLng: -80.13 },
      // Brazil
      { city: "Rio de Janeiro", country: "Brazil", baseLat: -22.91, baseLng: -43.17 },
      // Madrid
      { city: "Madrid", country: "Spain", baseLat: 40.42, baseLng: -3.70 },
    ];

    // Catálogo de amenities/tags mínimos
    const amenityCatalog = await models.HomeAmenity.bulkCreate(
      [
        { name: "Wifi", group_key: "BASICS", amenity_key: "WIFI", label: "Wifi" },
        { name: "A/C", group_key: "BASICS", amenity_key: "AC", label: "Air conditioning" },
        { name: "Kitchen", group_key: "BASICS", amenity_key: "KITCHEN", label: "Kitchen" },
        { name: "Washer", group_key: "BASICS", amenity_key: "WASHER", label: "Washer" },
        { name: "TV", group_key: "BASICS", amenity_key: "TV", label: "TV" },
      ],
      { transaction: tx, validate: false }
    );
    const tagCatalog = await models.HomeTag.bulkCreate(
      [
        { name: "Beach", tag_key: "BEACH", label: "Beach" },
        { name: "City", tag_key: "CITY", label: "City" },
        { name: "Mountain", tag_key: "MOUNTAIN", label: "Mountain" },
        { name: "Family", tag_key: "FAMILY", label: "Family" },
      ],
      { transaction: tx, validate: false }
    );

    // 10 homes por ciudad => 60 homes en 6 ciudades
    const homesPayload = [];
    for (let c = 0; c < homeLocations.length; c++) {
      const loc = homeLocations[c];
      for (let j = 0; j < 10; j++) {
        const idx = c * 10 + j;
        const host = hosts[idx % hosts.length];
        homesPayload.push({
          host_id: host.id,
          title: `Dev Home ${idx + 1}`,
          description: "Test home description",
          status: "PUBLISHED",
          is_visible: true,
          property_type: "HOUSE",
          space_type: "ENTIRE_PLACE",
          max_guests: 4 + (j % 3),
          bedrooms: 2 + (j % 2),
          beds: 2 + (j % 2),
          bathrooms: 1,
          marketing_tags: ["featured"],
          draft_step: 20,
          __loc: loc,
        });
      }
    }
    const homes = await models.Home.bulkCreate(homesPayload, { transaction: tx, validate: false });

    // Address, pricing, media, amenities, tags
    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      const loc = home.__loc || homeLocations[i % homeLocations.length];
      const jitter = (val) => (Math.random() - 0.5) * val;
      await models.HomeAddress.create(
        {
          home_id: home.id,
          address_line1: `Home St ${i + 1}`,
          city: loc.city,
          country: loc.country,
          state: loc.city,
          latitude: (loc.baseLat || 0) + jitter(0.05),
          longitude: (loc.baseLng || 0) + jitter(0.05),
        },
        { transaction: tx, validate: false }
      );
      await models.HomePricing.create(
        {
          home_id: home.id,
          currency: "USD",
          base_price: 120 + (i % 5) * 10,
          weekend_price: 150 + (i % 5) * 10,
          cleaning_fee: 30,
        },
        { transaction: tx, validate: false }
      );
      await models.HomeMedia.create(
        {
          home_id: home.id,
          url: `https://picsum.photos/seed/home${home.id}/800/600`,
          is_cover: true,
          order: 0,
        },
        { transaction: tx, validate: false }
      );
      // Amenity links (primeros 3)
      for (let a = 0; a < 3 && a < amenityCatalog.length; a++) {
        await models.HomeAmenityLink.create(
          { home_id: home.id, amenity_id: amenityCatalog[a].id },
          { transaction: tx, validate: false }
        );
      }
      // Tag links (primeros 2)
      for (let t = 0; t < 2 && t < tagCatalog.length; t++) {
        await models.HomeTagLink.create(
          { home_id: home.id, tag_id: tagCatalog[t].id },
          { transaction: tx, validate: false }
        );
      }
    }

    // Bookings HOME (120 bookings: 2 por home) con orígenes mezclados
    const homeBookingsPayload = [];
    const originBA = { lat: -34.61, lng: -58.42 };
    const originMiami = { lat: 25.76, lng: -80.19 };
    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      const locCity = home.__loc?.city || "";
      for (let k = 0; k < 2; k++) {
        const idx = i * 2 + k;
        const traveler = travelers[idx % travelers.length];
        const startDay = (idx % 20) + 1;
        const checkIn = new Date(Date.UTC(2025, 0, startDay));
        const checkOut = new Date(Date.UTC(2025, 0, startDay + 3));
        // origen: BA por defecto; para Madrid y Rio alternamos BA/Miami
        let origin = originBA;
        if (locCity === "Rio de Janeiro" || locCity === "Madrid") {
          origin = k % 2 === 0 ? originBA : originMiami;
        } else if (locCity.includes("Miami")) {
          origin = originMiami;
        }
        homeBookingsPayload.push({
          user_id: traveler.id,
          source: "HOME",
          inventory_type: "HOME",
          inventory_id: String(home.id),
          check_in: checkIn.toISOString().slice(0, 10),
          check_out: checkOut.toISOString().slice(0, 10),
          nights: 3,
          guest_name: traveler.name,
          guest_email: traveler.email,
          guest_phone: null,
          adults: 2,
          children: 0,
          status: "CONFIRMED",
          payment_status: "PAID",
          gross_price: 500 + (idx % 5) * 20,
          currency: "USD",
          booking_latitude: origin.lat,
          booking_longitude: origin.lng,
        });
      }
    }
    const homeBookings = await models.Booking.bulkCreate(homeBookingsPayload, {
      transaction: tx,
      validate: false,
    });
    for (let i = 0; i < homeBookings.length; i++) {
      const home = homes[i % homes.length];
      await models.StayHome.create(
        {
          stay_id: homeBookings[i].id,
          home_id: home.id,
          host_id: home.host_id,
        },
        { transaction: tx }
      );
    }

    // Bookings HOTEL
    for (let i = 0; i < 3; i++) {
      const traveler = travelers[i];
      const room = rooms[i];
      const booking = await models.Booking.create(
        {
          user_id: traveler.id,
          source: "PARTNER",
          inventory_type: "LOCAL_HOTEL",
          inventory_id: `hotel:${room.hotel_id}`,
          check_in: "2025-12-10",
          check_out: "2025-12-12",
          nights: 2,
          guest_name: traveler.name,
          guest_email: traveler.email,
          adults: 2,
          children: 0,
          status: "CONFIRMED",
          payment_status: "PAID",
          gross_price: 300,
          currency: "USD",
        },
        { transaction: tx, validate: false }
      );
      await models.StayHotel.create(
        { stay_id: booking.id, hotel_id: room.hotel_id, room_id: room.id },
        { transaction: tx, validate: false }
      );
    }

    await tx.commit();
    console.log("Seed OK");
  } catch (err) {
    console.error("Seed failed", err);
    await tx.rollback();
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
