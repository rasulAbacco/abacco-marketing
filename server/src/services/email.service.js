import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export async function fetchEmails(account) {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: true,
    auth: {
      user: account.username,
      pass: account.decryptedPass,
    },
  });

  await client.connect();

  let emails = [];

  const lock = await client.getMailboxLock("INBOX");
  try {
    for await (let msg of client.fetch("1:*", { envelope: true, source: true })) {
      emails.push({
        subject: msg.envelope.subject,
        from: msg.envelope.from?.[0]?.address,
      });
    }
  } finally {
    lock.release();
  }

  await client.logout();
  return emails;
}

export async function sendMail(account, to, subject, html) {
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: false,
    auth: {
      user: account.username,
      pass: account.decryptedPass,
    },
  });

  return transporter.sendMail({
    from: account.email,
    to,
    subject,
    html,
  });
}
