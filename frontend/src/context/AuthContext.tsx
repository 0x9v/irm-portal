"use client";
import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { fetchApi, ApiError } from "@/lib/api";

export type MembershipStatus = "ACTIVE" | "PENDING" | "REJECTED";
export type MembershipRole = "MEMBER" | "MODERATOR" | "DELEGATE";

export interface User {
  id: string;
  username: string;
  email: string;
  first_name: string;
  family_name: string;
}

export interface SelfMembershipInfo {
  id: string;
  status: MembershipStatus;
  role: MembershipRole;
}

export interface Capabilities {
  create_announcements: boolean;
  manage_document_voting: boolean;
  upload_official_documents: boolean;
}

export interface SelfMembershipResponse {
  membership: SelfMembershipInfo | null;
  capabilities: Capabilities;
}

interface AuthContextValue {
  user: User | null;
  membership: SelfMembershipInfo | null;
  capabilities: Capabilities | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<SelfMembershipInfo | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContext = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const userData = await fetchApi<User>("/api/v1/auth/me");
      setUser(userData);
      
      try {
        const memData = await fetchApi<SelfMembershipResponse>("/api/v1/communities/irm/membership/me");
        setMembership(memData.membership);
        setCapabilities(memData.capabilities);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // IRM community not found somehow
          setMembership(null);
          setCapabilities(null);
        } else {
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setMembership(null);
        setCapabilities(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContext();
  }, [fetchContext]);

  const logout = async () => {
    try {
      await fetchApi("/api/v1/auth/logout", { method: "POST" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // already logged out
      } else {
        throw err;
      }
    }
    setUser(null);
    setMembership(null);
    setCapabilities(null);
  };

  return (
    <AuthContext.Provider value={{ user, membership, capabilities, isLoading, error, refresh: fetchContext, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
