// server/src/routes/inbox/smtpMailerRoutes.js
import express from "express";
import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import crypto from "crypto"; // 👈 ADDED THIS IMPORT
import { decrypt } from "../../utils/crypto.js";
import cache from "../../utils/cache.js";


const router = express.Router();
const prisma = new PrismaClient();

// Configure Multer (Memory Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

router.post("/send", upload.array("attachments"), async (req, res) => {
  try {
    const {
      to,
      cc,
      subject,
      body,
      emailAccountId,
      conversationId,
      inReplyToId,
    } = req.body;

    // 1. Validation
    if (!to || !emailAccountId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (to, emailAccountId)",
      });
    }

    // 2. Fetch Account
    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
      include: { user: { select: { email: true, empId: true } } },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    const authenticatedEmail = account.smtpUser || account.email;
    const senderName = account.senderName || null;

    /* ============================================================
       🧠 CONVERSATION LOGIC (FIXED)
       ============================================================ */
    let finalConversationId = null;

    // A) If ID provided, verify it exists.
    if (
      conversationId &&
      conversationId !== "undefined" &&
      conversationId !== "null"
    ) {
      // Note: Since your DB uses String IDs, we don't wrap this in Number() if it's a UUID
      // But if your frontend sends numeric IDs, check your schema.
      // Based on error, it's a String.
      const exists = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      if (exists) finalConversationId = conversationId;
    }

    // B) Find by Email
    if (!finalConversationId) {
      // const existing = await prisma.conversation.findFirst({
      //   where: {
      //     AND: [
      //       { emailAccountId: Number(emailAccountId) },
      //       { participants: { contains: to } },
      //     ],
      //   },
      // });
      const existing = await prisma.conversation.findFirst({
        where: {
          OR: [{ toRecipients: to }, { participants: { contains: to } }],
        },
      });

      if (existing) {
        finalConversationId = existing.id;
        // await prisma.conversation.update({
        //   where: { id: existing.id },
        //   data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
        // });
      await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
        },
      });

      } else {
        // C) Create NEW Conversation (FIXED: Added ID)
        console.log("🆕 Creating new conversation for:", to);

        // 🛡️ GENERATE ID MANUALLY
        const newId = crypto.randomUUID();

        // const newConv = await prisma.conversation.create({
        //   data: {
        //     id: newId, // 👈 THE MISSING PIECE!
        //     emailAccountId: Number(emailAccountId),
        //     subject: subject || "(No Subject)",
        //     participants: `${authenticatedEmail}, ${to}`,
        //     toRecipients: to,
        //     initiatorEmail: authenticatedEmail,
        //     lastMessageAt: new Date(),
        //     messageCount: 1,
        //     unreadCount: 0,
        //   },
        // });
        const newConv = await prisma.conversation.create({
          data: {
            id: newId,
            subject: subject || "(No Subject)",
            participants: `${authenticatedEmail}, ${to}${cc ? `, ${cc}` : ""}`,
            toRecipients: to,
            ccRecipients: cc || null,
            initiatorEmail: authenticatedEmail,
            lastMessageAt: new Date(),
            messageCount: 1,
            unreadCount: 0,

            // ✅ THIS IS THE FIX
            account: {
              connect: {
                id: Number(emailAccountId),
              },
            },
          },
        });


        finalConversationId = newConv.id;
      }
    }

 
    /* ==============================
      4. CONFIGURE SMTP
      ============================== */
    const smtpPort = Number(account.smtpPort) || 465;
    const isSecure = smtpPort === 465;

    let smtpPassword = null;

    if (typeof account.encryptedPass === "string") {
      if (account.encryptedPass.includes(":")) {
        smtpPassword = decrypt(account.encryptedPass);
      } else {
        smtpPassword = account.encryptedPass;
      }
    }

    if (!smtpPassword) {
      return res.status(400).json({
        success: false,
        message: "SMTP password missing for this account",
      });
    }



    const domain = authenticatedEmail.split("@")[1] || "localhost.localdomain";

    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: smtpPort,
      secure: isSecure,
      name: domain,
      auth: {
        user: authenticatedEmail,
        pass: smtpPassword,
      },
      tls: { rejectUnauthorized: false },
    });



    /* ==============================
       5. PREPARE ATTACHMENTS
       ============================== */
    // For Nodemailer (Buffer)
    const smtpAttachments =
      req.files?.map((file) => ({
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      })) || [];

    // For Database (Metadata only for now, ideally upload to R2 here too)
    const attachmentRecords =
      req.files?.map((file) => ({
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageUrl: "", // Add R2 upload here if needed
        hash: "",
      })) || [];

    /* ==============================
       6. SEND EMAIL
       ============================== */


    const info = await transporter.sendMail({
      from: senderName
        ? `"${senderName}" <${authenticatedEmail}>`
        : authenticatedEmail,
      to,
      cc,
      subject,
      html: body,
    });



    console.log("📤 Email Sent! ID:", info.messageId);

    /* ==============================
       7. SAVE TO DATABASE
       ============================== */
    const savedMessage = await prisma.emailMessage.create({
        data: {
          emailAccountId: Number(emailAccountId),
          conversationId: finalConversationId,
          messageId: info.messageId,
          fromEmail: authenticatedEmail,
          fromName: senderName,
          toEmail: to,
          ccEmail: cc || null,
          subject: subject || "(No Subject)",
          body,
          direction: "sent",
          sentAt: new Date(),
          folder: "sent",
          isRead: true,
          attachments:
            attachmentRecords.length > 0
              ? { create: attachmentRecords }
              : undefined,
        },
        include: { attachments: true },
      });

      // 🔥 CLEAR INBOX CACHE AFTER SENDING MAIL
      try {
        const userId = account.userId;

        cache.del(`inbox:${userId}:${emailAccountId}:inbox`);
        cache.del(`inbox:${userId}:${emailAccountId}:sent`);
        cache.del(`inbox:${userId}:${emailAccountId}:spam`);
        cache.del(`inbox:${userId}:${emailAccountId}:trash`);

        console.log("🧹 Cache cleared for inbox");
      } catch (e) {
        console.warn("Cache clear failed:", e.message);
      }
 
      return res.json({ success: true, data: savedMessage });
    } catch (error) {
    console.error("❌ SMTP SEND ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      details: error.meta || error.message,
    });
  }
});

export default router;

 