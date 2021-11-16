/**
 * A Project's Flow
 * @namespce forge.db.models.StorageFlow
 */
const { DataTypes } = require('sequelize');

/*
 * This currently does the bare minimum, not history or user tracking
 */

module.exports = {
	name: 'StorageFlow',
  schema: {
    flow: { type: DataTypes.STRING, allowNull: false, defaultValue: "[]"}
  },
  associations: function(M) {
    this.belongsTo(M['Project']);
  },
  finders: function(M) {
    return {
      static: {
        byProject: async(project) => {
          return this.findOne({
            where: {ProjectID: project},
            attributes: ['id','flow']
          })
        }
      }
    }
  }
}