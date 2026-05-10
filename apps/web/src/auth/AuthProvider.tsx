import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { devBypassAuth, devUser } from "../lib/devBypass";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  bypass: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** A minimal User-shaped object the rest of the UI is happy with. */
const fakeDevUser = {
  id: devUser.id,
  email: devUser.email,
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
} as unknown as User;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!devBypassAuth);

  useEffect(() => {
    if (devBypassAuth) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = useMemo(() => {
    if (devBypassAuth) {
      return {
        user: fakeDevUser,
        session: null,
        loading: false,
        bypass: true,
        signIn: async () => {
          /* bypass mode: nothing to sign in to */
        },
        signUp: async () => {
          /* bypass mode: nothing to sign up to */
        },
        signOut: async () => {
          /* bypass mode: refuse — there is nowhere to go */
        },
      };
    }
    return {
      user: session?.user ?? null,
      session,
      loading,
      bypass: false,
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      },
      signUp: async (email, password) => {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
