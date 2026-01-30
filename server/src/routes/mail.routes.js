// import express from "express";
// import { syncInbox, getFolderEmails,syncAllAccounts  } from "../controllers/mail.controller.js";

// const router = express.Router();

// // Pull emails from real email server
// router.post("/sync/:accountId", syncInbox);

// // Get emails from database
// router.get("/:folder/:accountId", getFolderEmails);
// router.post("/sync-all", syncAllAccounts);

// export default router;

// model EmailAccount {
//   id            String   @id @default(uuid())
//   email         String   @unique
//   provider      String
//   imapHost      String
//   imapPort      Int
//   smtpHost      String
//   smtpPort      Int
//   username      String
//   encryptedPass String
//   createdAt     DateTime @default(now())

//   emails Email[]

//   @@index([email])
// }

// model Email {
//   id String @id @default(uuid())

//   messageId String?
//   subject   String?
//   from      String?
//   to        String?
//   body      String?

//   folder String  @default("inbox")
//   isRead Boolean @default(false)

//   receivedAt DateTime?
//   createdAt  DateTime  @default(now())
//   updatedAt  DateTime  @updatedAt

//   accountId  String
//   account    EmailAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
//   Attachment Attachment[]

//   @@index([accountId])
//   @@index([folder])
//   @@index([messageId, accountId])
// }

// model Attachment {
//   id String @id @default(uuid())

//   filename  String
//   mimeType  String
//   size      Int
//   contentId String? // for inline CID images

//   data Bytes // <-- ACTUAL FILE STORED HERE

//   emailId String
//   email   Email  @relation(fields: [emailId], references: [id], onDelete: Cascade)

//   createdAt DateTime @default(now())

//   @@index([emailId])
// }