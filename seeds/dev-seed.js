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
    const bookingsOnly =
      process.argv.includes("--bookings-only") ||
      process.env.SEED_ONLY_BOOKINGS === "1";

    // IMPORTANT: non-destructive mode -- only inserts new sample data.
    // No TRUNCATE/DELETE here to allow safe execution in shared environments.

    // Core actors (travelers/hosts)
    let travelers = [];
    let hosts = [];

    if (!bookingsOnly) {
      const travelerPayload = Array.from({ length: 5 }).map((_, i) => ({
        name: `Traveler ${i + 1}`,
        email: `trav${i + 1}@dev.local`,
        password_hash: passwordHash,
        role: 0,
      }));
      await models.User.bulkCreate(travelerPayload, {
        transaction: tx,
        validate: false,
        ignoreDuplicates: true,
      });
      travelers = await models.User.findAll({
        where: { email: travelerPayload.map((u) => u.email) },
        transaction: tx,
      });

      const hostPayload = Array.from({ length: 10 }).map((_, i) => ({
        name: `Host ${i + 1}`,
        email: `host${i + 1}@dev.local`,
        password_hash: passwordHash,
        role: 6,
      }));
      await models.User.bulkCreate(hostPayload, {
        transaction: tx,
        validate: false,
        ignoreDuplicates: true,
      });
      hosts = await models.User.findAll({
        where: { email: hostPayload.map((u) => u.email) },
        transaction: tx,
      });
      // Ensure host profiles exist
      for (const h of hosts) {
        await models.HostProfile.findOrCreate({
          where: { user_id: h.id },
          defaults: { user_id: h.id, metadata: { bio: "Dev host" } },
          transaction: tx,
        });
      }
    } else {
      travelers = await models.User.findAll({ where: { role: 0 }, transaction: tx });
      if (!travelers.length) {
        travelers = await models.User.findAll({ where: {}, transaction: tx });
      }
      hosts = await models.User.findAll({ where: { role: 6 }, transaction: tx });
      if (!travelers.length || !hosts.length) {
        throw new Error("bookings-only mode requires existing users/hosts");
      }
    }

    // Hoteles y rooms (idempotente por nombre y room_number)
    const hotelPayload = Array.from({ length: 3 }).map((_, i) => ({
      name: `Dev Hotel ${i + 1}`,
      city: "Test City",
      country: "Testland",
      address: `Street ${i + 1}`,
    }));
    const existingHotels = await models.Hotel.findAll({
      where: { name: hotelPayload.map((h) => h.name) },
      transaction: tx,
    });
    const existingHotelMap = new Map(existingHotels.map((h) => [h.name, h]));
    const hotelsToCreate = hotelPayload.filter((h) => !existingHotelMap.has(h.name));
    if (hotelsToCreate.length) {
      await models.Hotel.bulkCreate(hotelsToCreate, { transaction: tx, validate: false });
    }
    const hotels = await models.Hotel.findAll({
      where: { name: hotelPayload.map((h) => h.name) },
      transaction: tx,
    });

    const rooms = [];
    for (const hotel of hotels) {
      const desiredRooms = [
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
      ];

      for (const roomPayload of desiredRooms) {
        const existingRoom = await models.Room.findOne({
          where: { hotel_id: hotel.id, room_number: roomPayload.room_number },
          transaction: tx,
        });
        if (!existingRoom) {
          const created = await models.Room.create(roomPayload, { transaction: tx, validate: false });
          rooms.push(created);
        } else {
          rooms.push(existingRoom);
        }
      }
    }

        // Homes publicados
    const homeLocations = [
      // CABA y cercanias
      { city: "Buenos Aires", country: "Argentina", baseLat: -34.61, baseLng: -58.42 },
      { city: "Moreno", country: "Argentina", baseLat: -34.65, baseLng: -58.79 },
      // Miami y cercanias
      { city: "Miami", country: "USA", baseLat: 25.76, baseLng: -80.19 },
      { city: "Miami Beach", country: "USA", baseLat: 25.79, baseLng: -80.13 },
      { city: "Fort Lauderdale", country: "USA", baseLat: 26.12, baseLng: -80.14 },
      { city: "Hollywood", country: "USA", baseLat: 26.01, baseLng: -80.14 },
      { city: "Coral Gables", country: "USA", baseLat: 25.72, baseLng: -80.27 },
      { city: "Hialeah", country: "USA", baseLat: 25.86, baseLng: -80.28 },
      // Brazil
      { city: "Rio de Janeiro", country: "Brazil", baseLat: -22.91, baseLng: -43.17 },
      // Madrid
      { city: "Madrid", country: "Spain", baseLat: 40.42, baseLng: -3.70 },
    ];

    // Catálogo de amenities/tags mínimos
    const amenityPayload = [
      { name: "Wifi", group_key: "BASICS", amenity_key: "WIFI", label: "Wifi" },
      { name: "A/C", group_key: "BASICS", amenity_key: "AC", label: "Air conditioning" },
      { name: "Kitchen", group_key: "BASICS", amenity_key: "KITCHEN", label: "Kitchen" },
      { name: "Washer", group_key: "BASICS", amenity_key: "WASHER", label: "Washer" },
      { name: "TV", group_key: "BASICS", amenity_key: "TV", label: "TV" },
    ];
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
      { name: "Beach", tag_key: "BEACH", label: "Beach" },
      { name: "City", tag_key: "CITY", label: "City" },
      { name: "Mountain", tag_key: "MOUNTAIN", label: "Mountain" },
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

    // 10 homes por ciudad (evita duplicar por title)
    let homes = [];
    if (!bookingsOnly) {
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
      const existingHomes = await models.Home.findAll({
        where: { title: homesPayload.map((h) => h.title) },
        transaction: tx,
      });
      const existingHomeMap = new Map(existingHomes.map((h) => [h.title, h]));
      const homesToCreate = homesPayload.filter((h) => !existingHomeMap.has(h.title));
      if (homesToCreate.length) {
        await models.Home.bulkCreate(homesToCreate, { transaction: tx, validate: false });
      }
      homes = await models.Home.findAll({
        where: { title: homesPayload.map((h) => h.title) },
        transaction: tx,
      });
      homes = homes.map((home) => {
        const idx = Number(home.title.replace("Dev Home ", "")) - 1;
        const loc = homesPayload[idx]?.__loc || homeLocations[idx % homeLocations.length];
        return Object.assign(home, { __loc: loc });
      });

      // Address, pricing, media, amenities, tags (idempotente)
      for (let i = 0; i < homes.length; i++) {
        const home = homes[i];
        const loc = home.__loc || homeLocations[i % homeLocations.length];
        const jitter = (val) => (Math.random() - 0.5) * val;

        await models.HomeAddress.findOrCreate({
          where: { home_id: home.id },
          defaults: {
            home_id: home.id,
            address_line1: `Home St ${i + 1}`,
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
            base_price: 120 + (i % 5) * 10,
            weekend_price: 150 + (i % 5) * 10,
            cleaning_fee: 30,
          },
          transaction: tx,
          validate: false,
        });

        const mediaCount = await models.HomeMedia.count({
          where: { home_id: home.id },
          transaction: tx,
        });
        if (!mediaCount) {
          await models.HomeMedia.create(
            {
              home_id: home.id,
              url: `https://picsum.photos/seed/home${home.id}/800/600`,
              is_cover: true,
              order: 0,
            },
            { transaction: tx, validate: false }
          );
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
    } else {
      homes = await models.Home.findAll({
        include: [{ model: models.HomeAddress, as: "address" }],
        transaction: tx,
      });
      homes = homes.map((h) => {
        const address = h.address || {};
        const lat = Number(address.latitude);
        const lng = Number(address.longitude);
        return Object.assign(h, {
          __loc: {
            city: address.city || null,
            country: address.country || null,
            baseLat: Number.isFinite(lat) ? lat : 0,
            baseLng: Number.isFinite(lng) ? lng : 0,
          },
        });
      });
    }

    // Bookings HOME (120 bookings: 2 por home) con orígenes mezclados
    const homeBookingsPayload = [];
    const existingHomeBookings = await models.Booking.findAll({
      attributes: ["user_id", "inventory_id", "check_in", "check_out"],
      where: { inventory_type: "HOME" },
      transaction: tx,
      raw: true,
    });
    const existingHomeBookingKeys = new Set(
      existingHomeBookings.map(
        (b) => `HOME|${b.user_id}|${b.inventory_id}|${b.check_in}|${b.check_out}`
      )
    );
    const originBA = { lat: -34.61, lng: -58.42 };
    const originMiami = { lat: 25.76, lng: -80.19 };
    const pushHomeBooking = ({ home, traveler, idx, origin, nights = 3, startOffsetDays = -10 }) => {
      const baseStart = addDays(now, startOffsetDays - (idx % 5));
      const checkIn = baseStart;
      const checkOut = addDays(baseStart, nights);
      const key = `HOME|${traveler.id}|${home.id}|${checkIn.toISOString().slice(0, 10)}|${checkOut
        .toISOString()
        .slice(0, 10)}`;
      if (existingHomeBookingKeys.has(key)) return;
      existingHomeBookingKeys.add(key);
      homeBookingsPayload.push({
        user_id: traveler.id,
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
        status: "COMPLETED",
        payment_status: "PAID",
        gross_price: 500 + (idx % 5) * 20,
        currency: "USD",
        booking_latitude: origin.lat,
        booking_longitude: origin.lng,
      });
    };
    const now = new Date();
    const addDays = (base, days) => {
      const copy = new Date(base.getTime());
      copy.setUTCDate(copy.getUTCDate() + days);
      return copy;
    };

    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      const locCity = home.__loc?.city || "";
      for (let k = 0; k < 2; k++) {
        const idx = i * 2 + k;
        const traveler = travelers[idx % travelers.length];
        let origin = originBA;
        if (locCity === "Rio de Janeiro" || locCity === "Madrid") {
          origin = k % 2 === 0 ? originBA : originMiami;
        } else if (locCity.includes("Miami")) {
          origin = originMiami;
        }
        pushHomeBooking({ home, traveler, idx, origin, nights: 3, startOffsetDays: -10 });
      }
    }

    // Extra bookings originating in Miami (travelers from Miami booking other cities)
    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      const locCity = home.__loc?.city || "";
      if (locCity.includes("Miami")) continue; // skip local Miami homes for this extra flow
      const traveler = travelers[(i + 3) % travelers.length];
      const idx = i + 500; // arbitrary offset for price variation
      pushHomeBooking({ home, traveler, idx, origin: originMiami, nights: 4, startOffsetDays: -6 });
    }
    const homeBookings = homeBookingsPayload.length
      ? await models.Booking.bulkCreate(homeBookingsPayload, {
          transaction: tx,
          validate: false,
        })
      : [];
    for (const booking of homeBookings) {
      const homeId = Number(booking.inventory_id);
      if (!Number.isFinite(homeId)) continue;
      const home = homes.find((h) => h.id === homeId);
      if (!home) continue;
      const stayExists = await models.StayHome.findOne({
        where: { stay_id: booking.id, home_id: home.id },
        transaction: tx,
      });
      if (stayExists) continue;
      await models.StayHome.create(
        {
          stay_id: booking.id,
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
      const existing = await models.Booking.findOne({
        where: {
          user_id: traveler.id,
          inventory_type: "LOCAL_HOTEL",
          inventory_id: `hotel:${room.hotel_id}`,
          check_in: "2025-12-10",
          check_out: "2025-12-12",
        },
        transaction: tx,
      });
      if (!existing) {
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





