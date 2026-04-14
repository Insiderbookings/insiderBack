"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("partner_hotel_claim").catch(() => null);
    if (!table) return;

    if (!table.profile_snapshot) {
      const JSON_TYPE =
        queryInterface.sequelize.getDialect() === "mysql" ? Sequelize.JSON : Sequelize.JSONB;
      await queryInterface.addColumn("partner_hotel_claim", "profile_snapshot", {
        type: JSON_TYPE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("partner_hotel_claim").catch(() => null);
    if (!table?.profile_snapshot) return;
    await queryInterface.removeColumn("partner_hotel_claim", "profile_snapshot");
  },
};
