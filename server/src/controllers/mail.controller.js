// import { PrismaClient } from "@prisma/client";
// import { fetchEmailsForAccount } from "../services/imap.service.js";

// const prisma = new PrismaClient();

// // Fetch from IMAP and store
// export const syncInbox = async (req, res) => {
//   try {
//     const { accountId } = req.params;

//     const result = await fetchEmailsForAccount(accountId);

//     res.json({
//       success: true,
//       fetched: result.savedCount,
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };

// // Get emails from DB
// export const getInboxEmails = async (req, res) => {
//   try {
//     const { accountId } = req.params;

//     const emails = await prisma.email.findMany({
//       where: {
//         accountId,
//         folder: "inbox",
//       },
//       orderBy: {
//         createdAt: "desc", // ✅ FIXED
//       },
//     });

//     res.json(emails);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };

// export const getSentEmails = async (req, res) => {
//   try {
//     const { accountId } = req.params;

//     const emails = await prisma.email.findMany({
//       where: {
//         accountId,
//         folder: "sent",
//       },
//       orderBy: {
//         createdAt: "desc",
//       },
//     });

//     res.json(emails);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };

// export const syncAllAccounts = async (req, res) => {
//   try {
//     const accounts = await prisma.emailAccount.findMany();

//     let totalFetched = 0;

//     for (const acc of accounts) {
//       try {
//         const result = await fetchEmailsForAccount(acc.id);
//         totalFetched += result.savedCount;
//       } catch (err) {
//         console.error(`Failed syncing ${acc.email}:`, err.message);
//       }
//     }

//     res.json({
//       success: true,
//       totalFetched,
//       accounts: accounts.length,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };


// export const getFolderEmails = async (req, res) => {
//   try {
//     const { accountId, folder } = req.params;

//     const allowedFolders = [
//       "inbox",
//       "sent",
//       "draft",
//       "junk",
//       "trash",
//     ];


//     if (!allowedFolders.includes(folder)) {
//       return res.status(400).json({ error: "Invalid folder" });
//     }

//     const emails = await prisma.email.findMany({
//       where: {
//         accountId,
//         folder,
//       },
//       orderBy: {
//         createdAt: "desc",
//       },
//     });

//     res.json(emails);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };
