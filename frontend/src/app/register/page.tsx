"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import { formatFormError, FormErrors } from "@/lib/validation";

type RegisterResponse = {
  id: string;
  username: string;
  email: string;
  first_name: string;
  family_name: string;
};

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    first_name: "",
    family_name: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });
  const [success, setSuccess] = useState(false);

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
    setSuccess(false);
    setLoading(true);

    try {
      await fetchApi<RegisterResponse>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      setSuccess(true);
    } catch (err) {
      const formatted = formatFormError(err, "Registration failed. Please check your information and try again.");
      setErrors(formatted);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-4 sm:p-8 font-sans max-w-lg mx-auto mt-6 sm:mt-10">
      <div className="mb-4">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-800 hover:underline inline-flex items-center gap-1"
        >
          &larr; Back to IRM Hub
        </Link>
      </div>

      <div className="p-6 sm:p-8 border border-gray-200 rounded-xl shadow-sm bg-white">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Create an Account</h1>
        <p className="text-sm text-gray-500 mb-6">
          Register to join the IRM academic community platform.
        </p>

        {success ? (
          <div className="space-y-4">
            <div className="p-5 text-green-800 bg-green-50 border border-green-200 rounded-xl">
              <h2 className="text-lg font-bold text-green-900 mb-2">
                Your account was created successfully!
              </h2>
              <p className="text-sm text-green-800 leading-relaxed mb-4">
                Creating an account and joining the community are separate steps. You can now log in and submit an IRM membership request with your student CNE to gain full community access.
              </p>
              <Link
                href="/login"
                className="inline-block bg-green-700 hover:bg-green-800 text-white font-medium px-5 py-2.5 rounded-lg shadow-sm text-sm transition-colors"
              >
                Continue to Log In &rarr;
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {errors.general && (
              <div
                role="alert"
                className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
              >
                {errors.general}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                disabled={loading}
                className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                  errors.fields.username ? "border-red-400 bg-red-50/50" : "border-gray-300"
                }`}
                value={formData.username}
                onChange={handleChange}
                placeholder="e.g. amina_dev"
              />
              {errors.fields.username && (
                <p className="text-xs text-red-600 mt-1" role="alert">
                  {errors.fields.username}
                </p>
              )}
            </div>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="first_name">
                  First Name
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  type="text"
                  autoComplete="given-name"
                  required
                  disabled={loading}
                  className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                    errors.fields.first_name ? "border-red-400 bg-red-50/50" : "border-gray-300"
                  }`}
                  value={formData.first_name}
                  onChange={handleChange}
                />
                {errors.fields.first_name && (
                  <p className="text-xs text-red-600 mt-1" role="alert">
                    {errors.fields.first_name}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="family_name">
                  Family Name
                </label>
                <input
                  id="family_name"
                  name="family_name"
                  type="text"
                  autoComplete="family-name"
                  required
                  disabled={loading}
                  className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                    errors.fields.family_name ? "border-red-400 bg-red-50/50" : "border-gray-300"
                  }`}
                  value={formData.family_name}
                  onChange={handleChange}
                />
                {errors.fields.family_name && (
                  <p className="text-xs text-red-600 mt-1" role="alert">
                    {errors.fields.family_name}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
                Password <span className="text-xs text-gray-500 font-normal">(minimum 8 characters)</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
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
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-gray-100 text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 hover:text-blue-800 font-medium hover:underline">
            Log in
          </Link>
        </div>
      </div>
    </main>
  );
}
