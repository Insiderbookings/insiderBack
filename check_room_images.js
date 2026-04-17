import models, { sequelize } from './src/models/index.js';

// ---------------------------------------------------------------
// Diagnóstico: rooms sin imágenes para un hotel específico
// Uso: node check_room_images.js
// ---------------------------------------------------------------

const HOTEL_ID = 31264;
const PROBLEM_CODE = '1363905195';

(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB conectada.\n');

    // 1. Total de room types en static para este hotel
    const total = await models.WebbedsHotelRoomType.count({
      where: { hotel_id: HOTEL_ID },
    });
    console.log(`Total room types en static para hotel ${HOTEL_ID}: ${total}`);

    // 2. Buscar el código problemático
    const problematic = await models.WebbedsHotelRoomType.findAll({
      where: { hotel_id: HOTEL_ID, roomtype_code: PROBLEM_CODE },
      attributes: ['id', 'roomtype_code', 'name', 'room_info', 'raw_payload'],
    });

    if (problematic.length === 0) {
      console.log(`\n❌ roomTypeCode ${PROBLEM_CODE} NO existe en el static pool de hotel ${HOTEL_ID}`);
      console.log('   → Este es un caso "Le Meridien": el código live no tiene contraparte estática.');
    } else {
      console.log(`\n✅ roomTypeCode ${PROBLEM_CODE} encontrado: ${problematic.length} fila(s)`);
      problematic.forEach((rt, i) => {
        const raw = rt.raw_payload || {};
        const roomImages = raw.roomImages || raw.room_images || [];
        const imageCount = Array.isArray(roomImages) ? roomImages.length : 0;
        const desc = raw.roomDescription || raw.room_description || raw.description || null;
        console.log(`   [${i + 1}] id=${rt.id} name="${rt.name}" images=${imageCount} hasDescription=${Boolean(desc)}`);
      });
    }

    // 3. Mostrar los códigos live del hotel que SÍ están en static con imágenes
    const liveCodes = ['61834', '90991645', '1363905195', '61844', '61854', '61874', '645547875'];
    console.log('\n--- Estado de los 7 códigos live en el static pool ---');
    for (const code of liveCodes) {
      const rows = await models.WebbedsHotelRoomType.findAll({
        where: { hotel_id: HOTEL_ID, roomtype_code: code },
        attributes: ['roomtype_code', 'name', 'raw_payload'],
        limit: 1,
      });
      if (rows.length === 0) {
        console.log(`  ❌ ${code} — no existe en static`);
      } else {
        const raw = rows[0].raw_payload || {};
        const roomImages = raw.roomImages || raw.room_images || [];
        const imageCount = Array.isArray(roomImages) ? roomImages.length : 0;
        const desc = raw.roomDescription || raw.room_description || null;
        console.log(`  ${imageCount > 0 ? '✅' : '⚠️ '} ${code} "${rows[0].name}" — images=${imageCount} description=${desc ? `"${String(desc).slice(0, 60)}"` : 'null'}`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await sequelize.close();
  }
})();
