"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage("Password updated. Returning to the workspace…");
      window.setTimeout(() => { router.replace("/"); router.refresh(); }, 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page"><section className="auth-brand"><a className="brand" href="/"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></a></section><section className="auth-content"><div className="auth-card"><div className="auth-eyebrow">ACCOUNT SECURITY <span /> PASSWORD RESET</div><h1>Set a new password<span>.</span></h1><p className="auth-intro">Choose a strong password for your SFI workspace account.</p><form className="auth-form" onSubmit={handleSubmit}><label>New password<input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" /></label><button className="auth-submit" disabled={busy}>{busy ? "Updating…" : "Update password"}<span>→</span></button></form>{message && <p className="auth-message" role="status">{message}</p>}<p className="auth-legal">Password reset links expire. If yours has expired, request a new one from the sign-in screen.</p></div><div className="auth-footer"><span>Clarity on Markets. Intelligence for Capital.</span><span>NG · WEST AFRICA</span></div></section></main>;
}
