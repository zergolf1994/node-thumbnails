const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const FilesThumb = sequelize.define('files_thumb', {
    id: {
      type: DataTypes.INTEGER(11),
      primaryKey: true,
      autoIncrement: true,
    },
    slug: {
      type: DataTypes.STRING(20),
      defaultValue: "",
    },
    type: {
      type: DataTypes.STRING(20),
      defaultValue: "",
    },
    backup: {
      type: DataTypes.STRING(255),
      defaultValue: "",
    },
    createdAt: {
      type: DataTypes.DATE,
    },
    updatedAt: {
      type: DataTypes.DATE,
    },
});
  
(async () => {
  await FilesThumb.sync({ force: false });
})();

module.exports = FilesThumb;