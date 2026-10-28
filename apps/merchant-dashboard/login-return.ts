export function invitationState(search: string): { invite?: string } {
  const invite = new URLSearchParams(search).get("invite");
  return invite && /^[a-f0-9]{64}$/.test(invite) ? { invite } : {};
}
export function invitationSearch(state: unknown): string {
  if (
    !state ||
    typeof state !== "object" ||
    !("invite" in state) ||
    typeof state.invite !== "string" ||
    !/^[a-f0-9]{64}$/.test(state.invite)
  )
    return "";
  return "?invite=" + state.invite;
}
