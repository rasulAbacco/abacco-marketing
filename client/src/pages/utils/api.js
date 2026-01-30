// api.js
import axios from "axios";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// 🔐 Attach JWT token to every request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// 🌐 Global API error handler
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error(
      "API Error:",
      error.response?.data || error.message || "Unknown API error"
    );

    // Auto logout if token expired
   if (error.response?.status === 401) {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/";   // <-- put your real login route here
}


    return Promise.reject(error);
  }
);
