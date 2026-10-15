"use client";
import { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from "react";
import { fetchApi, ApiError } from "@/lib/api";

export type MembershipStatus = "ACTIVE" | "PENDING" | "REJECTED" | "REMOVED" | "BANNED" | (string & {});
export type MembershipRole = "MEMBER" | "MODERATOR" | "DELEGATE";

export interface User {
  id: string;
  username: string;
  email: string;
  first_name: string;
  family_name: string;
  avatar_url: string | null;
}

export interface SelfMembershipInfo {
  id: string;
  status: MembershipStatus;
  role: MembershipRole;
  cne: string | null;
  applicant_type: "STUDENT" | "LAUREATE" | null;
  applicant_first_name: string | null;
  applicant_family_name: string | null;
  identifier_type: "MASSAR" | "FOREIGN" | null;
  promotion: string | null;
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

export interface AuthRevalidationResult {
  isAuthenticated: boolean;
  isActiveMember: boolean;
  user: User | null;
  membership: SelfMembershipInfo | null;
  membershipError: string | null;
}

export interface AuthContextValue {
  user: User | null;
  membership: SelfMembershipInfo | null;
  capabilities: Capabilities | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isLoggingOut: boolean;
  error: string | null;
  membershipError: string | null;
  refresh: () => Promise<AuthRevalidationResult>;
  logout: () => Promise<void>;
  clearAuthenticatedState: (expectedUserId: string, passwordChanged?: boolean) => boolean;
  passwordChangedNotice: boolean;
  consumePasswordChangedNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<SelfMembershipInfo | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [passwordChangedNotice, setPasswordChangedNotice] = useState(false);

  const latestRequestIdRef = useRef<number>(0);
  const currentUserIdRef = useRef<string | null>(null);
  const initialLoadDoneRef = useRef<boolean>(false);

  const fetchContext = useCallback(async (): Promise<AuthRevalidationResult> => {
    const currentRequestId = ++latestRequestIdRef.current;
    if (!initialLoadDoneRef.current) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    setMembershipError(null);
    let currentUser: User | null = null;
    let currentMem: SelfMembershipInfo | null = null;
    let currentMemError: string | null = null;
    try {
      const userData = await fetchApi<User>("/api/v1/auth/me");
      if (currentRequestId !== latestRequestIdRef.current) {
        return {
          isAuthenticated: false,
          isActiveMember: false,
          user: null,
          membership: null,
          membershipError: null,
        };
      }
      currentUser = userData;
      currentUserIdRef.current = userData.id;
      setPasswordChangedNotice(false);
      setUser(userData);
      
      try {
        const memData = await fetchApi<SelfMembershipResponse>("/api/v1/communities/irm/membership/me");
        if (currentRequestId !== latestRequestIdRef.current) {
          return {
            isAuthenticated: false,
            isActiveMember: false,
            user: null,
            membership: null,
            membershipError: null,
          };
        }
        currentMem = memData.membership;
        setMembership(memData.membership);
        setCapabilities(memData.capabilities);
        setMembershipError(null);
      } catch (memErr) {
        if (currentRequestId !== latestRequestIdRef.current) {
          return {
            isAuthenticated: false,
            isActiveMember: false,
            user: null,
            membership: null,
            membershipError: null,
          };
        }
        // Distinguish authentication failure from membership-fetch failure.
        // A failed membership request must not make an authenticated user appear logged out.
        // Privileged controls are kept hidden when capability state is unknown.
        setMembership(null);
        setCapabilities(null);
        currentMemError = memErr instanceof Error ? memErr.message : "Failed to verify membership status";
        setMembershipError(currentMemError);
      }
    } catch (err) {
      if (currentRequestId !== latestRequestIdRef.current) {
        return {
          isAuthenticated: false,
          isActiveMember: false,
          user: null,
          membership: null,
          membershipError: null,
        };
      }
      if (err instanceof ApiError && err.status === 401) {
        currentUserIdRef.current = null;
        setUser(null);
        setMembership(null);
        setCapabilities(null);
        setMembershipError(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    } finally {
      if (currentRequestId === latestRequestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        initialLoadDoneRef.current = true;
      }
    }

    return {
      isAuthenticated: currentUser !== null,
      isActiveMember: currentUser !== null && currentMem?.status === "ACTIVE" && !currentMemError,
      user: currentUser,
      membership: currentMem,
      membershipError: currentMemError,
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContext();
  }, [fetchContext]);

  // Password change already revoked the cookie on the server. Invalidate any
  // older refresh before clearing local protected state, without POSTing logout.
  const clearAuthenticatedState = useCallback((expectedUserId: string, passwordChanged = false) => {
    if (currentUserIdRef.current !== expectedUserId) return false;
    latestRequestIdRef.current++;
    currentUserIdRef.current = null;
    setUser(null);
    setMembership(null);
    setCapabilities(null);
    setError(null);
    setMembershipError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    if (passwordChanged) setPasswordChangedNotice(true);
    return true;
  }, []);

  const consumePasswordChangedNotice = useCallback(() => setPasswordChangedNotice(false), []);

  const logout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    // Invalidate any in-flight session fetch requests immediately
    latestRequestIdRef.current++;

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000);

    try {
      await fetchApi("/api/v1/auth/logout", {
        method: "POST",
        signal: abortController.signal,
      });

      // Backend confirmation succeeded: clear session state
      currentUserIdRef.current = null;
      setUser(null);
      setMembership(null);
      setCapabilities(null);
      setMembershipError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Already logged out on backend: confirmed
        currentUserIdRef.current = null;
        setUser(null);
        setMembership(null);
        setCapabilities(null);
        setMembershipError(null);
      } else {
        // Preserves authenticated state on failure, rethrowing for caller to handle retry
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
      setIsLoggingOut(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        membership,
        capabilities,
        isLoading,
        isRefreshing,
        isLoggingOut,
        error,
        membershipError,
        refresh: fetchContext,
        logout,
        clearAuthenticatedState,
        passwordChangedNotice,
        consumePasswordChangedNotice,
      }}
    >
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
