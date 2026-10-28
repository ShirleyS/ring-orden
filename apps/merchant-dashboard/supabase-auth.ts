declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SESSION_KEY = "ring-orden-supabase-session";

export function clearBrowserSignIn() {
  localStorage.removeItem(SESSION_KEY);
}

export const clearSupabaseSession = clearBrowserSignIn;

type BrowserSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export const supabaseAuthConfigured = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY,
);

function readSession(): BrowserSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const session = JSON.parse(value) as BrowserSession;
    if (
      typeof session.access_token !== "string" ||
      typeof session.refresh_token !== "string" ||
      typeof session.expires_at !== "number"
    ) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveSession(tokens: TokenResponse) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    } satisfies BrowserSession),
  );
}

export function consumeSupabaseMagicLink(): string | null {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const expiresIn = Number(hash.get("expires_in"));
  if (accessToken && refreshToken && Number.isFinite(expiresIn)) {
    saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
    });
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    return null;
  }
  const message = hash.get("error_description");
  if (message) {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    return message.replaceAll("+", " ");
  }
  return null;
}

export async function requestSupabaseMagicLink(email: string) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY)
    throw new Error("Sign-in is not configured yet. Please try again shortly.");
  const redirectTo = window.location.origin;
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email.trim(), create_user: true }),
    },
  );
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as {
      msg?: string;
      message?: string;
    };
    throw new Error(
      detail.msg || detail.message || "We could not send your sign-in link.",
    );
  }
}

let refreshInFlight: Promise<string | null> | undefined;
export async function supabaseAccessToken(): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  const session = readSession();
  if (!session) return null;
  if (session.expires_at > Date.now() + 60_000) return session.access_token;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const current = readSession();
      if (!current) return null;
      const response = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: current.refresh_token }),
        },
      );
      if (!response.ok) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      const tokens = (await response.json()) as TokenResponse;
      saveSession(tokens);
      return tokens.access_token;
    })().finally(() => {
      refreshInFlight = undefined;
    });
  }
  return refreshInFlight;
}
