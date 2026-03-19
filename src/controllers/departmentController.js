const Department = require("../model/departmentModel");
const logAudit = require("../utils/auditlogger");
const mongoose = require("mongoose");

const createDepartment = async (req, res) => {
    const { name, isActive = true } = req.body;
    try {
        const existing = await Department.findOne({ name: name.trim() });

        if (existing) {
            return res.status(400).json({ success: false, message: "Department already exists" });
        }

        const newDepartment = new Department({ name: name.trim(), isActive });
        await newDepartment.save();

        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: 'CREATE',
            targetModel: 'Department',
            targetId: newDepartment._id,
            description: `Created department: ${newDepartment.name}`,
            changes: {
                name: newDepartment.name,
                isActive: newDepartment.isActive
            }
        });

        res.status(201).json({
            success: true,
            message: "Department created successfully",
            data: newDepartment
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
}

const getAllDepartment = async (req, res) => {
    try {
        const allDepartment = await Department.find().sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            data: allDepartment,
            totalItems: allDepartment.length,
            message: "All Department fetched successfully",
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
}

const getDepartmentById = async (req, res) => {
    const { id } = req.params;

    try {
        const department = await Department.findById(id);

        if (!department) {
            return res.status(404).json({
                success: false,
                message: "Department not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: department,
            message: "Department fetched successfully",
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

const updateDepartment = async (req, res) => {
    const { id } = req.params;
    const updateBody = req.body;

    try {
        if (!id) {
            return res.status(400).json({ message: "ID is missing" })
        }
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const updatedDepartment = await Department.findByIdAndUpdate(
            id,
            updateBody,
            { new: true, runValidators: true }
        );
        if (!updatedDepartment) {
            return res.status(404).json({ message: "No data found" });
        }

        const changes = {};
        if (updateBody.name && updateBody.name !== updatedDepartment.name) {
            changes.name = { old: updatedDepartment.name, new: updateBody.name };
        }

        if (
            updateBody.isActive !== undefined &&
            updateBody.isActive !== updatedDepartment.isActive
        ) {
            changes.isActive = {
                old: updatedDepartment.isActive,
                new: updateBody.isActive,
            };
        }

        // Audit log
        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: "UPDATE",
            targetModel: "Department",
            targetId: updatedDepartment._id,
            description: `Updated Department ${updatedDepartment.name}`,
            changes,
        });

        return res.status(200).json({
            success: true,
            message: "Department updated successfully",
            data: updatedDepartment,
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

const deleteDepartment = async (req, res) => {
    const { id } = req.params;

    try {
        // Validate ID
        if (!id) {
            return res.status(400).json({ message: "ID is missing" });
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }

        // Check if department exists
        const department = await Department.findById(id);
        
        if (!department) {
            return res.status(404).json({ message: "Department not found" });
        }

        // Delete the department
        await Department.findByIdAndDelete(id);

        // Log the deletion
        await logAudit({
            userId: req.user.id,
            username: req.user.username,
            action: "DELETE",
            targetModel: "Department",
            targetId: department._id,
            description: `Deleted Department: ${department.name}`,
            changes: {
                name: department.name,
                isActive: department.isActive,
            }
        });

        return res.status(200).json({ success: true, message: "Department deleted successfully" });

    } catch (error) {
        return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
};

module.exports = { createDepartment, getAllDepartment, getDepartmentById, updateDepartment, deleteDepartment }