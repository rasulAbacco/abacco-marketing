/**
 * Replace placeholders in email templates
 * @param {string} template - HTML template with placeholders
 * @param {object} data - Data object with replacement values
 * @returns {string} - Template with placeholders replaced
 */
export function replacePlaceholders(template, data) {
  if (!template) return "";

  let result = template;

  // Define all available placeholders
  const placeholders = {
    "{sender_name}": data.senderName || "",
    "{client_name}":
      data.clientName || data.recipientName || "[Recipient Name]",
    "{company}": data.company || data.companyName || "",
    "{email}": data.email || data.recipientEmail || "",
    "{date}": new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    "{time}": new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    "{phone}": data.phone || "",
    "{website}": data.website || "",
  };

  // Replace all placeholders
  Object.keys(placeholders).forEach((placeholder) => {
    const regex = new RegExp(placeholder.replace(/[{}]/g, "\\$&"), "gi");
    result = result.replace(regex, placeholders[placeholder]);
  });

  return result;
}

/**
 * Build email signature from sender name
 */
export function buildSignature(senderName) {
  if (!senderName) return "";

  return `
    <br/>
    <div style="margin-top: 20px; font-family: Calibri, sans-serif; font-size: 11pt;">
      <div>Best regards,</div>
      <div style="font-weight: bold; margin-top: 5px;">${senderName}</div>
    </div>
  `;
}

/**
 * Extract recipient name from email
 */
export function extractRecipientName(email, fromName) {
  if (fromName && fromName.trim() !== email) {
    return fromName.trim();
  }

  // Extract from email (before @)
  const namePart = email.split("@")[0];

  // Convert john.doe or john_doe to John Doe
  return namePart
    .split(/[._-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// // client/src/utils/templateReplacer.js

// /**
//  * Replace template placeholders with actual values
//  *
//  * Supported placeholders:
//  * - {sender_name} → Account sender name
//  * - {client_name} → Recipient name
//  * - {company} → Company name
//  * - {email} → Recipient email
//  * - {date} → Current date
//  * - {time} → Current time
//  */

// export const replacePlaceholders = (template, data = {}) => {
//   if (!template) return "";

//   let result = template;

//   // Sender name (from email account)
//   if (data.senderName) {
//     result = result.replace(/\{sender_name\}/gi, data.senderName);
//   }

//   // Client/Recipient name
//   if (data.clientName) {
//     result = result.replace(/\{client_name\}/gi, data.clientName);
//   }

//   // Company name
//   if (data.company) {
//     result = result.replace(/\{company\}/gi, data.company);
//   }

//   // Email address
//   if (data.email) {
//     result = result.replace(/\{email\}/gi, data.email);
//   }

//   // Date (current date)
//   const currentDate = new Date().toLocaleDateString("en-US", {
//     year: "numeric",
//     month: "long",
//     day: "numeric",
//   });
//   result = result.replace(/\{date\}/gi, currentDate);

//   // Time (current time)
//   const currentTime = new Date().toLocaleTimeString("en-US", {
//     hour: "2-digit",
//     minute: "2-digit",
//   });
//   result = result.replace(/\{time\}/gi, currentTime);

//   return result;
// };

// /**
//  * Get all placeholders used in a template
//  */
// export const extractPlaceholders = (template) => {
//   if (!template) return [];

//   const regex = /\{([^}]+)\}/g;
//   const matches = [];
//   let match;

//   while ((match = regex.exec(template)) !== null) {
//     matches.push(match[1]);
//   }

//   return [...new Set(matches)]; // Remove duplicates
// };

// /**
//  * Validate if all required placeholders have values
//  */
// export const validatePlaceholders = (template, data) => {
//   const placeholders = extractPlaceholders(template);
//   const missing = [];

//   placeholders.forEach((placeholder) => {
//     const key = placeholder.toLowerCase().replace(/_/g, "");
//     if (!data[key] && !data[placeholder]) {
//       missing.push(placeholder);
//     }
//   });

//   return {
//     isValid: missing.length === 0,
//     missing,
//   };
// };

// /**
//  * Get available placeholder options
//  */
// export const AVAILABLE_PLACEHOLDERS = [
//   {
//     key: "{sender_name}",
//     label: "Sender Name",
//     description: "Your name from the email account",
//     example: "John Smith",
//   },
//   {
//     key: "{client_name}",
//     label: "Client Name",
//     description: "Recipient's name",
//     example: "Jane Doe",
//   },
//   {
//     key: "{company}",
//     label: "Company Name",
//     description: "Client's company",
//     example: "Acme Corp",
//   },
//   {
//     key: "{email}",
//     label: "Email Address",
//     description: "Recipient's email",
//     example: "jane@example.com",
//   },
//   {
//     key: "{date}",
//     label: "Current Date",
//     description: "Today's date",
//     example: "January 8, 2026",
//   },
//   {
//     key: "{time}",
//     label: "Current Time",
//     description: "Current time",
//     example: "02:30 PM",
//   },
// ];

// export default replacePlaceholders;
