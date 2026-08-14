import type { AuthResponse, LoginInput, PublicUser, RegisterInput } from "@yu-book/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, refreshSession, setAccessToken } from "./api";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: PublicUser | null;
  status: Status;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Restaura a sessão no boot: o cookie httpOnly de refresh é a única coisa
  // que sobrevive ao reload.
  useEffect(() => {
    let active = true;

    refreshSession()
      .then((session) => {
        if (!active) return;
        setUser(session?.user ?? null);
        setStatus(session ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (!active) return;
        setStatus("anonymous");
      });

    return () => {
      active = false;
    };
  }, []);

  const applySession = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      applySession(await api.post<AuthResponse>("/auth/login", input));
    },
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      applySession(await api.post<AuthResponse>("/auth/register", input));
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return context;
}
