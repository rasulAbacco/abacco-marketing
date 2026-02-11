import express from "express";
import { 
  registerUser, 
  loginUser, 
  getCurrentUser,  // ✅ NEW: Import getCurrentUser
  getAllUsers, 
  updateUser, 
  deleteUser, 
  toggleUserStatus 
} from "../controllers/userController.js";

// ✅ Import your auth middleware (adjust path as needed)
import { protect } from "../middlewares/authMiddleware.js";


const router = express.Router();


// ✅ Public routes (no auth required)
router.post("/register", registerUser);
router.post("/login", loginUser);

// ✅ Protected routes (auth required)
router.get("/me", protect, getCurrentUser);           // ✅ NEW: Get current user profile
router.get("/all", protect, getAllUsers);             // ✅ Protected: Only authenticated users
router.put("/:id", protect, updateUser);              // ✅ Protected
router.delete("/:id", protect, deleteUser);           // ✅ Protected
router.put("/:id/status", protect, toggleUserStatus); // ✅ Protected


export default router;