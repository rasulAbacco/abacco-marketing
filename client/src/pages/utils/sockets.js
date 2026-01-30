
import { io } from "socket.io-client";

let socket = null;

export function initSocket(userId) {
  if (socket) return socket;

  socket = io(import.meta.env.VITE_API_BASE_URL, {
    withCredentials: true,
    transports: ["websocket"],
    path: "/socket.io/",
    auth: { userId }, // IMPORTANT!
  });

  socket.on("connect", () => {
    console.log("🟢 Connected to socket server:", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔴 Disconnected:", reason);
  });

  return socket;
}

export function getSocket() {
  return socket;
}

// // src/sockets.js
// import { io } from "socket.io-client";

// const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4002";

// export function createSocket({ userId, userName }) {
//   const socket = io(API_URL, {
//     query: { userId, userName },
//     autoConnect: true,
//   });
//   return socket;
// }
