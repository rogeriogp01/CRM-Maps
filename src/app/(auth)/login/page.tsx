"use client";

import { useState, Suspense } from "react";
import { Lock, Mail, ArrowRight, ShieldCheck, Zap, MapPin, Send } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message || "Credenciais inválidas.");
        setIsLoading(false);
        return;
      }

      // Force a server round-trip so middleware sees the fresh session cookie
      // before rendering the dashboard.
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao autenticar.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.05)_0%,transparent_50%)]"></div>
      <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_70%_80%,rgba(59,130,246,0.05)_0%,transparent_50%)]"></div>

      <div className="w-full max-w-md p-8 relative z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4 shadow-xl shadow-primary/10">
            <Zap size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">MapDisparo CRM</h1>
          <p className="text-muted-foreground mt-2">A ferramenta definitiva para prospecção no WhatsApp.</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary outline-none transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium" htmlFor="password">
                  Senha
                </label>
                <Link href="#" className="text-xs text-primary hover:underline">
                  Esqueceu a senha?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary outline-none transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="text-sm rounded-lg border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary text-primary-foreground h-12 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 active:scale-[0.98] disabled:opacity-50"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Entrar na Conta
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-border">
            <p className="text-sm text-center text-muted-foreground">
              Ainda não tem conta?{" "}
              <Link href="#" className="text-primary font-semibold hover:underline">
                Fale com o admin
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-4">
          <div className="flex flex-col items-center gap-1">
            <MapPin size={16} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Maps</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Send size={16} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">WhatsApp</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ShieldCheck size={16} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Anti-Ban</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
