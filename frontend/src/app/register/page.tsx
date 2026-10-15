"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import { formatFormError, FormErrors } from "@/lib/validation";
import AccountPage from "@/components/auth/AccountPage";
import styles from "@/components/auth/AccountPage.module.css";
import FeedbackMessage from "@/components/FeedbackMessage";
import Button, { PendingLabel } from "@/components/ui/Button";

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
    if (loading) return;
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
    <AccountPage kind="register" submitting={loading}>
      <div className={styles.formIntro}>
        <h1>Create an account</h1>
        <p>Create your EtudSup account first, then request IRM membership separately. All fields are required.</p>
      </div>

        {success ? (
          <div className="space-y-4">
            <div className={styles.success} role="status">
              <h2>Your account was created successfully!</h2>
              <p>Sign in to EtudSup, then request IRM membership. Community access is confirmed separately after your request is reviewed.</p>
              <Link
                href="/login"
                className="ui-button ui-button--primary"
              >
                Continue to sign in &rarr;
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            {errors.general && (
              <div className="mb-4">
                <FeedbackMessage type="error" message={errors.general} />
              </div>
            )}

            <div className={styles.nameRow}>
              <div>
                <label className="ui-label" htmlFor="first_name">
                  First Name
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  type="text"
                  autoComplete="given-name"
                  required
                  disabled={loading}
                  className="ui-field"
                  aria-invalid={Boolean(errors.fields.first_name)}
                  aria-describedby={errors.fields.first_name ? "register-first_name-error" : undefined}
                  value={formData.first_name}
                  onChange={handleChange}
                  placeholder="e.g. Sara"
                />
                {errors.fields.first_name && (
                  <p id="register-first_name-error" className="ui-field-error" role="alert">
                    {errors.fields.first_name}
                  </p>
                )}
              </div>

              <div>
                <label className="ui-label" htmlFor="family_name">
                  Family Name
                </label>
                <input
                  id="family_name"
                  name="family_name"
                  type="text"
                  autoComplete="family-name"
                  required
                  disabled={loading}
                  className="ui-field"
                  aria-invalid={Boolean(errors.fields.family_name)}
                  aria-describedby={errors.fields.family_name ? "register-family_name-error" : undefined}
                  value={formData.family_name}
                  onChange={handleChange}
                  placeholder="e.g. El Mansouri"
                />
                {errors.fields.family_name && (
                  <p id="register-family_name-error" className="ui-field-error" role="alert">
                    {errors.fields.family_name}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="ui-label" htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                disabled={loading}
                className="ui-field"
                aria-invalid={Boolean(errors.fields.username)}
                aria-describedby={errors.fields.username ? "register-username-error" : "register-username-hint"}
                value={formData.username}
                onChange={handleChange}
                placeholder="e.g. sara_elm"
              />
              {errors.fields.username ? (
                <p id="register-username-error" className="ui-field-error" role="alert">{errors.fields.username}</p>
              ) : (
                <p id="register-username-hint" className={styles.fieldHint}>Use 3 to 50 characters.</p>
              )}
            </div>

            <div>
              <label className="ui-label" htmlFor="email">Email Address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={loading}
                className="ui-field"
                aria-invalid={Boolean(errors.fields.email)}
                aria-describedby={errors.fields.email ? "register-email-error" : "register-email-hint"}
                value={formData.email}
                onChange={handleChange}
                placeholder="e.g. sara@gmail.com"
              />
              {errors.fields.email ? (
                <p id="register-email-error" className="ui-field-error" role="alert">{errors.fields.email}</p>
              ) : (
                <p id="register-email-hint" className={styles.fieldHint}>Any valid email address works.</p>
              )}
            </div>

            <div>
              <label className="ui-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={loading}
                className="ui-field"
                aria-invalid={Boolean(errors.fields.password)}
                aria-describedby={errors.fields.password ? "register-password-error" : "register-password-hint"}
                value={formData.password}
                onChange={handleChange}
              />
              {errors.fields.password ? (
                <p id="register-password-error" className="ui-field-error" role="alert">
                  {errors.fields.password}
                </p>
              ) : (
                <p id="register-password-hint" className={styles.fieldHint}>Use at least 8 characters.</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={loading} aria-busy={loading}
              className="w-full mt-2"
            >
              <PendingLabel pending={!!(loading)} idle="Create account" busy="Creating account..." />
            </Button>
          </form>
        )}

        <div className={styles.formAlt}>
          Already have an account?{" "}
          <Link href="/login">
            Sign in
          </Link>
        </div>
    </AccountPage>
  );
}
