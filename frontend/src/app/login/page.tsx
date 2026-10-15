"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatFormError, FormErrors } from "@/lib/validation";
import AccountPage from "@/components/auth/AccountPage";
import styles from "@/components/auth/AccountPage.module.css";
import FeedbackMessage from "@/components/FeedbackMessage";
import Button, { PendingLabel } from "@/components/ui/Button";

type UserResponse = {
  id: string;
  username: string;
  email: string;
  first_name: string;
  family_name: string;
};

export default function LoginPage() {
  const router = useRouter();
  const { refresh, passwordChangedNotice, consumePasswordChangedNotice } = useAuth();
  const [showPasswordChangedNotice] = useState(passwordChangedNotice);

  useEffect(() => {
    if (showPasswordChangedNotice) consumePasswordChangedNotice();
  }, [showPasswordChangedNotice, consumePasswordChangedNotice]);

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
    if (loading) return;
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
      router.push("/account#community-membership");
    } catch (err) {
      const formatted = formatFormError(err, "Login failed. Please check your credentials and try again.");
      setErrors(formatted);
      setLoading(false);
    }
  };

  return (
    <AccountPage kind="login" submitting={loading}>
      <div className={styles.formIntro}>
        <h1>Sign in</h1>
        <p>Welcome back to EtudSup. Sign in with the email address you used to create your account.</p>
      </div>

        {showPasswordChangedNotice && <div className="mb-5">
          <FeedbackMessage type="success" message="Password changed. Sign in with your new password." />
        </div>}

        {errors.general && (
          <div className="mb-5">
            <FeedbackMessage type="error" message={errors.general} />
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div>
            <label className="ui-label" htmlFor="email">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={loading}
              className="ui-field"
              aria-invalid={Boolean(errors.fields.email)}
              aria-describedby={errors.fields.email ? "login-email-error" : "login-email-hint"}
              value={formData.email}
              onChange={handleChange}
              placeholder="e.g. sara@gmail.com"
            />
            {errors.fields.email && (
              <p id="login-email-error" className="ui-field-error" role="alert">
                {errors.fields.email}
              </p>
            )}
            {!errors.fields.email && <p id="login-email-hint" className={styles.fieldHint}>Any email provider works; use the address on your account.</p>}
          </div>

          <div>
            <label className="ui-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={loading}
              className="ui-field"
              aria-invalid={Boolean(errors.fields.password)}
              aria-describedby={errors.fields.password ? "login-password-error" : undefined}
              value={formData.password}
              onChange={handleChange}
            />
            {errors.fields.password && (
              <p id="login-password-error" className="ui-field-error" role="alert">
                {errors.fields.password}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={loading} aria-busy={loading}
            className="w-full mt-2"
          >
            <PendingLabel pending={!!(loading)} idle="Sign in" busy="Signing in..." />
          </Button>
        </form>

        <div className={styles.formAlt}>
          Don&apos;t have an account?{" "}
          <Link href="/register">
            Create an account
          </Link>
        </div>
    </AccountPage>
  );
}
