"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, Mail, CheckCircle2, Lock, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (authError) {
        throw authError;
      }

      setIsSent(true);
      toast.success("Magic link sent! Check your email.");
    } catch (err) {
      setError((err as Error).message || "Failed to send magic link");
      toast.error((err as Error).message || "Failed to send magic link");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        throw authError;
      }

      if (data?.session) {
        toast.success("Signed in successfully");
        router.push("/scouts");
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message || "Sign in failed");
      toast.error((err as Error).message || "Sign in failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Sparkles className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">Forager</h1>
          <p className="text-xs text-muted-foreground">
            Autonomous Trajectory-Aware Web Research Agent
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          {/* Sign in method switch */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 border border-border text-xs">
            <button
              type="button"
              onClick={() => {
                setMode("magic");
                setError(null);
              }}
              className={`rounded-md py-1.5 font-medium transition-colors cursor-pointer ${
                mode === "magic"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Magic Link
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("password");
                setError(null);
              }}
              className={`rounded-md py-1.5 font-medium transition-colors cursor-pointer ${
                mode === "password"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Password
            </button>
          </div>

          {isSent && mode === "magic" ? (
            <div className="text-center space-y-3 py-2">
              <CheckCircle2 className="h-8 w-8 text-success mx-auto" />
              <h2 className="text-sm font-semibold text-foreground">Check your email</h2>
              <p className="text-xs text-muted-foreground">
                We sent a magic link to <strong className="text-foreground">{email}</strong>. Click
                the link in your inbox to sign in.
              </p>
              <button
                type="button"
                onClick={() => setIsSent(false)}
                className="text-xs text-primary hover:underline pt-2 cursor-pointer"
              >
                Use another email address
              </button>
            </div>
          ) : mode === "magic" ? (
            <form onSubmit={handleSendMagicLink} className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold text-foreground">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="researcher@lab.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  required
                  autoFocus
                  className="text-xs"
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full text-xs font-semibold cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Sending Link...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-3.5 w-3.5" />
                    Send Magic Link
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSignIn} className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="pwd-email" className="text-xs font-semibold text-foreground">
                  Email Address
                </Label>
                <Input
                  id="pwd-email"
                  type="email"
                  autoComplete="email"
                  placeholder="researcher@lab.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  required
                  autoFocus
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  required
                  className="text-xs"
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full text-xs font-semibold cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-3.5 w-3.5" />
                    Sign In with Password
                  </>
                )}
              </Button>
            </form>
          )}
        </div>

        <div className="text-center">
          <p className="text-[11px] text-muted-foreground">
            Secure session authentication via Supabase PKCE
          </p>
        </div>
      </div>
    </div>
  );
}
