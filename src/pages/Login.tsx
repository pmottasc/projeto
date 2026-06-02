import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import logoHub from '@/assets/logo-hub.png';
// Trigger bootstrap-superadmin once when the login screen loads.
if (typeof window !== 'undefined' && !(window as any).__bootstrapAttempted) {
  (window as any).__bootstrapAttempted = true;
  fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bootstrap-superadmin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => {});
}


export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const err = await login(email, password);
    if (err) setError('E-mail ou senha inválidos');
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background decoration — brand glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-3xl opacity-30 dark:opacity-20" style={{ background: 'hsl(var(--brand-magenta) / 0.18)' }} />
        <div className="absolute top-1/3 right-0 w-[600px] h-[500px] rounded-full blur-3xl opacity-30 dark:opacity-20" style={{ background: 'hsl(var(--brand-violet) / 0.18)' }} />
        <div className="absolute bottom-0 left-1/2 w-[700px] h-[400px] rounded-full blur-3xl opacity-30 dark:opacity-20" style={{ background: 'hsl(var(--brand-blue) / 0.18)' }} />
      </div>

      <div className="relative w-full max-w-[420px] animate-fade-in">
        {/* Card */}
        <div className="bg-card rounded-2xl shadow-xl border border-border/60 p-10">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center h-[72px] w-[72px] rounded-2xl shadow-sm mb-5 overflow-hidden">
              <img src={logoHub} alt="Hub HelpDesk" className="h-full w-full object-contain" />
            </div>
            <h1 className="text-xl font-bold brand-gradient-text tracking-tight">Hub HelpDesk</h1>
            <p className="text-[13px] text-muted-foreground mt-1.5">Acesse sua conta para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-2.5 rounded-lg bg-destructive/5 border border-destructive/10 p-3.5 text-[13px] text-destructive animate-scale-in">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-[13px] font-medium">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="h-11 text-[13px]"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-[13px] font-medium">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 text-[13px]"
                required
              />
            </div>

            <Button type="submit" className="w-full h-11 text-[13px] font-semibold mt-2" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>Entrar <ArrowRight className="h-4 w-4 ml-1.5" /></>
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground/50 mt-8">
          Hub HelpDesk · Sistema de Chamados Internos
        </p>
      </div>
    </div>
  );
}
