import bcrypt from "bcrypt"
import models from "../models/index.js"
import { Op } from "sequelize" // ← Agregar esta importación

/* ───────────── GET /api/users/me ───────────── */
export const getCurrentUser = async (req, res) => {
  try {
    const user = await models.User.findByPk(req.user.id, {
      attributes: ["id", "name", "email", "phone", "isActive", "createdAt"],
    })

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    return res.json(user)
  } catch (err) {
    console.error("Error getting current user:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ───────────── PUT /api/users/me ───────────── */
export const updateUserProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body
    const userId = req.user.id

    // Validaciones básicas
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" })
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" })
    }

    // Validar que el email no esté en uso por otro usuario
    const existingUser = await models.User.findOne({
      where: {
        email,
        id: { [Op.ne]: userId }, // ← Usar Op importado directamente
      },
    })

    if (existingUser) {
      return res.status(400).json({ error: "Email already in use" })
    }

    // Validar teléfono si se proporciona
    if (phone && phone.trim()) {
      const phoneRegex = /^\+?[0-9\s\-()]{10,15}$/
      if (!phoneRegex.test(phone.replace(/\s/g, ""))) {
        return res.status(400).json({ error: "Invalid phone number format" })
      }
    }

    // Actualizar usuario
    const [updatedRowsCount] = await models.User.update(
      {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
      },
      {
        where: { id: userId },
        returning: true,
      },
    )

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: "User not found" })
    }

    // Obtener usuario actualizado
    const updatedUser = await models.User.findByPk(userId, {
      attributes: ["id", "name", "email", "phone", "isActive", "createdAt"],
    })

    return res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    })
  } catch (err) {
    console.error("Error updating user profile:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ───────────── PUT /api/users/me/password ───────────── */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    const userId = req.user.id

    // Validaciones básicas
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" })
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters long" })
    }

    // Obtener usuario con contraseña
    const user = await models.User.findByPk(userId)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Verificar contraseña actual
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: "Current password is incorrect" })
    }

    // Verificar que la nueva contraseña sea diferente
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash)
    if (isSamePassword) {
      return res.status(400).json({ error: "New password must be different from current password" })
    }

    // Hashear nueva contraseña
    const saltRounds = 12
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds)

    // Actualizar contraseña
    await models.User.update({ passwordHash: newPasswordHash }, { where: { id: userId } })

    return res.json({ message: "Password changed successfully" })
  } catch (err) {
    console.error("Error changing password:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* ───────────── DELETE /api/users/me ───────────── */
export const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body
    const userId = req.user.id

    // Validar que se proporcione la contraseña
    if (!password) {
      return res.status(400).json({ error: "Password is required to delete account" })
    }

    // Obtener usuario
    const user = await models.User.findByPk(userId)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash)
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Incorrect password" })
    }

    // Verificar si el usuario tiene bookings activos
    const activeBookings = await models.Booking.findAll({
      where: {
        user_id: userId,
        status: ["pending", "confirmed"],
        checkOut: { [Op.gte]: new Date() }, // ← Usar Op importado directamente
      },
    })

    if (activeBookings.length > 0) {
      return res.status(400).json({
        error: "Cannot delete account with active bookings. Please cancel or complete your bookings first.",
      })
    }

    // En lugar de eliminar completamente, desactivar la cuenta
    await models.User.update(
      {
        isActive: false,
        email: `deleted_${Date.now()}_${user.email}`, // Para evitar conflictos de email único
      },
      { where: { id: userId } },
    )

    return res.json({ message: "Account deleted successfully" })
  } catch (err) {
    console.error("Error deleting account:", err)
    return res.status(500).json({ error: "Server error" })
  }
}
