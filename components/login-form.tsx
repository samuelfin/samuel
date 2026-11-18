"use client";

import { type SubmitEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ configured, setupRequired }: { configured: boolean; setupRequired: boolean }) {
  const router = useRouter();
  const setup = setupRequired || !configured;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendResetLink() {
    if (!configured || !email) {
      setMessage("Enter your email address first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) throw error;
      setMessage("If an account matches that address, a reset link is on its way.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the reset link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand"><Link className="brand" href="/" aria-label="Samuel Terminal"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link></section>
      <section className="auth-content">
        <div className="auth-card">
          <div className="auth-eyebrow">SAMUEL TERMINAL <span /> SECURE WORKSPACE</div>
          <h1>{setup ? "Workspace setup" : "Welcome back"}<span>.</span></h1>
          <p className="auth-intro">{setup ? "Connect the SFI authentication project to open your financial intelligence workspace." : "Sign in to your SFI financial intelligence workspace."}</p>
          {setup ? (
            <div className="setup-guide">
              <div className="setup-warning"><span>i</span><div><strong>Supabase credentials are not configured.</strong><p>Authentication is ready to connect. Add your project URL and publishable key to enable sign-in.</p></div></div>
              <ol><li>Copy <code>.env.example</code> to <code>.env.local</code>.</li><li>Paste the Supabase project URL and publishable key.</li><li>Apply the migration in <code>supabase/migrations</code>.</li></ol>
              <div className="setup-status"><span /> AUTH MODULE <strong>READY FOR CONFIGURATION</strong></div>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
              <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>
              <button className="auth-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}<span>→</span></button>
              <button className="reset-link" type="button" disabled={busy} onClick={sendResetLink}>Forgot password?</button>
            </form>
          )}
          {message && <p className="auth-message" role="status">{message}</p>}
          <div className="auth-divider"><span /> SFI FINANCIAL INTELLIGENCE <span /></div>
          <p className="auth-legal">Access is limited to invited users. Contact your SFI workspace administrator if you need an account.</p>
        </div>
        <div className="auth-footer"><span>Clarity on Markets. Intelligence for Capital.</span><span>NG · WEST AFRICA</span></div>
      </section>
      <div className="auth-decoration" aria-hidden="true"><i /><i /><i /><span>DATA PROVENANCE<br />BY DESIGN</span></div>
    </main>
  );
}
