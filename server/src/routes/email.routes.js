import express from "express";
import { addAccount, listAccounts,getAccountById } from "../controllers/emailAccount.controller.js";

const router = express.Router();

router.post("/add", addAccount);
router.get("/list", listAccounts);
router.get("/:id", getAccountById);

export default router;
 