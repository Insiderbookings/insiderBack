// Migration: update seed goal text to English

async function up(queryInterface) {
  try {
    await queryInterface.sequelize.query(
      `UPDATE influencer_goal
       SET name = '50 referred bookings',
           description = 'Get coupons when you reach 50 referred bookings.',
           updated_at = NOW()
       WHERE code = 'BOOKING_50_COUPONS'`
    )
  } catch (err) {
    console.warn("Could not update influencer goal text:", err?.message || err)
  }
}

async function down(queryInterface) {
  try {
    await queryInterface.sequelize.query(
      `UPDATE influencer_goal
       SET name = '50 reservas referidas',
           description = 'Entrega cupones cuando el influencer llega a 50 bookings confirmadas de referidos.',
           updated_at = NOW()
       WHERE code = 'BOOKING_50_COUPONS'`
    )
  } catch (err) {
    console.warn("Could not revert influencer goal text:", err?.message || err)
  }
}

module.exports = { up, down }
