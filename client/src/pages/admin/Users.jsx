import React, { useState } from "react";
import { api } from "../utils/api"; // adjust path if needed

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await api.post("/api/users/login", { email, password });
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data));
      window.location.href = "/"; // change to your dashboard route
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>
      <div style={{ width: 360, background: "#fff", padding: 24, borderRadius: 8, boxShadow: "0 10px 25px rgba(0,0,0,0.1)" }}>
        <h2 style={{ textAlign: "center", marginBottom: 8 }}>Login</h2>
        <p style={{ textAlign: "center", color: "#64748b", marginBottom: 16 }}>Sign in to your account</p>

        {error && (
          <div style={{ marginBottom: 12, padding: 10, background: "#fee2e2", color: "#b91c1c", borderRadius: 6 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #cbd5f5" }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label>Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #cbd5f5" }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ width: "100%", padding: 12, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            {loading ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
