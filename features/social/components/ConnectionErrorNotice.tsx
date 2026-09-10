import { AlertTriangle } from "lucide-react";

/**
 * Phase 9 — what to say when a connection attempt did not complete.
 *
 * THE WHOLE POINT OF THIS COMPONENT is that the URL carries a short CODE and
 * nothing else. The callback route cannot put a message in a redirect, and a
 * provider's own error text never reaches a screen — so nothing arbitrary
 * from a query string is ever rendered, and no provider response can be
 * reflected back at a reader.
 *
 * An unrecognised code renders nothing rather than echoing itself.
 *
 * Not a client component: it renders text from a prop and has no state.
 */
const MESSAGES: Record<string, string> = {
  /*
   * Covers unknown, expired, reused and malformed alike. Deliberately one
   * message: which of those it was is server-side information, and a person's
   * next step — start again — is the same for all of them.
   */
  state: "That connection attempt was no longer valid, so nothing was connected. Start again from the account below.",
  denied: "The platform did not grant access, so nothing was connected.",
  session: "You were signed out partway through, so nothing was connected. Try connecting again.",
  config: "This platform is not configured for connecting yet, so nothing was connected.",
  exchange: "The platform did not complete the authorization, so nothing was connected. Try again.",
  /* The call to the platform failed — different from the platform answering "none". */
  pages: "The platform's pages could not be read, so nothing was connected. Try again.",
  /*
   * The platform answered, and the answer was none. Its own sentence, because
   * telling someone their Pages "could not be read" when they simply have no
   * Page this app may act on would send them looking for the wrong problem.
   */
  no_pages:
    "No Facebook Pages are available for this account. Nothing was connected. Check that the Facebook account you authorized with manages the Page you expected.",
};

export default function ConnectionErrorNotice({ code }: { code?: string }) {
  if (!code) return null;
  const message = MESSAGES[code];
  if (!message) return null;

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}
