"use client";

import { useState } from "react";
import { fetchApi, ApiError } from "../../lib/api";

type UserResponse = {
  id: string;
  username: string;
  email: string;
  first_name: string;
  family_name: string;
};

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserResponse | null>(null);
  const [verificationResult, setVerificationResult] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const verifySession = async () => {
    try {
      await fetchApi("/api/v1/communities/irm/modules");
      setVerificationResult("Session verified: Successfully accessed protected route.");
    } catch {
      setVerificationResult("Session verification failed.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUser(null);
    setVerificationResult(null);
    setLoading(true);

    try {
      const responseUser = await fetchApi<UserResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      setUser(responseUser);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 400 || err.status === 404) {
          setError(err.message || "Invalid email or password.");
        } else if (err.status === 422) {
          setError(`Validation error: ${err.message}`);
        } else {
          setError(`Login failed: ${err.message}`);
        }
      } else if (err instanceof Error) {
        setError(err.message || "Unable to connect to the server. Please try again.");
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8 font-sans max-w-lg mx-auto mt-10">
      <h1 className="text-2xl font-bold mb-6">IRM Portal</h1>
      <div className="p-6 border border-gray-200 rounded-lg shadow-sm bg-white">
        <h2 className="text-xl font-semibold mb-4">Login</h2>
        
        {user ? (
          <div>
            <div className="p-4 mb-4 text-green-700 bg-green-50 border border-green-200 rounded">
              <p className="font-semibold mb-1">Login successful</p>
              <p>Welcome, {user.username}</p>
            </div>
            
            <button
              onClick={verifySession}
              className="mt-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-1 px-3 rounded border border-gray-300"
            >
              Verify HTTP-only Session
            </button>
            
            {verificationResult && (
              <div className={`mt-3 p-2 text-sm rounded ${verificationResult.includes("failed") ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                {verificationResult}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.email}
                onChange={handleChange}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.password}
                onChange={handleChange}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Logging in..." : "Login"}
            </button>
          </form>
        )}
        
        <div className="mt-6 text-center text-sm text-gray-600">
          Don&apos;t have an account?{" "}
          <a href="/register" className="text-blue-600 hover:underline">
            Create one
          </a>
        </div>
      </div>
    </main>
  );
}
