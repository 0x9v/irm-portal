"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatFormError, FormErrors } from "@/lib/validation";

type UserResponse = {
  id: string;
  username: string;
  email: string;
  first_name: string;
  family_name: string;
};

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear field-specific error as user types
    if (errors.fields[name]) {
      setErrors((prev) => ({
        ...prev,
        fields: {
          ...prev.fields,
          [name]: "",
        },
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({ fields: {} });
    setLoading(true);

    try {
      await fetchApi<UserResponse>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(formData),
      });

      // Login succeeded. Refresh shared auth state.
      try {
        await refresh();
      } catch {
        // If refresh fails after login, auth cookie is set; continue to destination
      }

      // Navigate into the existing IRM membership page as default post-login destination
      router.push("/communities/irm/membership");
    } catch (err) {
      const formatted = formatFormError(err, "Login failed. Please check your credentials and try again.");
      setErrors(formatted);
      setLoading(false);
    }
  };

  return (
    <main className="p-4 sm:p-8 font-sans max-w-md mx-auto mt-6 sm:mt-12">
      <div className="mb-4">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-800 hover:underline inline-flex items-center gap-1"
        >
          &larr; Back to IRM Hub
        </Link>
      </div>

      <div className="p-6 sm:p-8 border border-gray-200 rounded-xl shadow-sm bg-white">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Log In</h1>
        <p className="text-sm text-gray-500 mb-6">
          Sign in to access your IRM community account.
        </p>

        {errors.general && (
          <div
            role="alert"
            className="p-3 mb-5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
          >
            {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={loading}
              className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                errors.fields.email ? "border-red-400 bg-red-50/50" : "border-gray-300"
              }`}
              value={formData.email}
              onChange={handleChange}
              placeholder="you@domain.com"
            />
            {errors.fields.email && (
              <p className="text-xs text-red-600 mt-1" role="alert">
                {errors.fields.email}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={loading}
              className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                errors.fields.password ? "border-red-400 bg-red-50/50" : "border-gray-300"
              }`}
              value={formData.password}
              onChange={handleChange}
            />
            {errors.fields.password && (
              <p className="text-xs text-red-600 mt-1" role="alert">
                {errors.fields.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-gray-100 text-center text-sm text-gray-600">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-blue-600 hover:text-blue-800 font-medium hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </main>
  );
}
