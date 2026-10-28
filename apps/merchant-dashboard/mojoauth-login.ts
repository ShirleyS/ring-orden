import { invitationState, invitationSearch } from "./login-return";
import { clearSupabaseSession } from "./supabase-auth";
import { UserManager, WebStorageStateStore } from "oidc-client-ts";

type Configuration = {
  provider: "mojoauth" | null;
  issuer?: string;
  clientId?: string;
};
let managerPromise: Promise<UserManager | null> | undefined;
function manager(): Promise<UserManager | null> {
  return (managerPromise ??= (async () => {
    const response = await fetch("/api/auth/config", { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        "Sign-in configuration could not be loaded. Please refresh.",
      );
    const config = (await response.json()) as Configuration;
    if (config.provider !== "mojoauth") return null;
    if (!config.issuer || !config.clientId)
      throw new Error("MojoAuth sign-in is not configured.");
    return new UserManager({
      authority: config.issuer,
      client_id: config.clientId,
      redirect_uri: window.location.origin,
      response_type: "code",
      scope: "openid profile email",
      loadUserInfo: false,
      automaticSilentRenew: false,
      monitorSession: false,
      stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    });
  })());
}
export async function mojoAuthConfigured(): Promise<boolean> {
  return Boolean(await manager());
}
export async function signInWithMojoAuth() {
  const auth = await manager();
  if (!auth) throw new Error("MojoAuth sign-in is not configured.");
  await auth.signinRedirect({ state: invitationState(window.location.search) });
}
let callback: Promise<boolean> | undefined;
export function finishMojoAuthSignIn(): Promise<boolean> {
  const query = new URLSearchParams(window.location.search);
  if (!query.has("state") || !(query.has("code") || query.has("error")))
    return Promise.resolve(false);
  return (callback ??= (async () => {
    const auth = await manager();
    if (!auth) throw new Error("MojoAuth sign-in is not configured.");
    let returnSearch = "";
    try {
      const user = await auth.signinRedirectCallback();
      returnSearch = invitationSearch(user.state);
      if (!user.id_token)
        throw new Error("MojoAuth did not return a sign-in token.");
      const response = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: user.id_token }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          data.error || "Sign-in could not be completed. Please try again.",
        );
      }
      clearSupabaseSession();
      return true;
    } finally {
      await auth.removeUser();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + returnSearch,
      );
    }
  })());
}
