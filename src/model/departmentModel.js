const mongoose = require('mongoose');

const DepartmentSchema = new mongoose.Schema(
  {
    name: {type: String,required: [true, 'Department name is required'],unique: true,trim: true},
    isActive: {type: Boolean, default: true}
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Department',DepartmentSchema);
