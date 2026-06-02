import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard, Ticket, Users, Bell, LogOut, Menu, KeyRound, BookOpen, Phone,
  ChevronLeft, Sun, Moon, FileSpreadsheet, Shield, FileCog, MessageCircle, Briefcase, Headset, Settings2, BarChart3,
  DollarSign, AlertTriangle, Kanban, Landmark, MessageSquareText, CalendarClock, FileCode2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
import { useChatUnread, useChatUnreadDetailed } from '@/hooks/useChatUnread';
import { useTenantBranding } from '@/hooks/useTenantBranding';
import UserProfileMenu from '@/components/UserProfileMenu';
import logoHub from '@/assets/logo-hub.png';


interface AppLayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

export default function AppLayout({ children, currentPage, onNavigate }: AppLayoutProps) {
  const { user, logout, isAdmin } = useAuth();
  const { isPlatformAdmin, isTenantAdmin, tenantId, tenant } = useTenant();
  const [billingStatus, setBillingStatus] = useState<string | null>(null);
  const [openInvoice, setOpenInvoice] = useState<{ id: string; due_date: string; amount_cents: number } | null>(null);

  useEffect(() => {
    if (!tenantId || !isTenantAdmin) { setBillingStatus(null); setOpenInvoice(null); return; }
    void (async () => {
      const [b, i] = await Promise.all([
        supabase.from('tenant_billing').select('status').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('tenant_invoices').select('id, due_date, amount_cents, status')
          .eq('tenant_id', tenantId).in('status', ['pendente', 'vencida'])
          .order('due_date', { ascending: true }).limit(1).maybeSingle(),
      ]);
      setBillingStatus((b.data as any)?.status || null);
      setOpenInvoice(i.data as any);
    })();
  }, [tenantId, isTenantAdmin]);
  const { isEnabled } = useTenantFeatures();
  const { branding } = useTenantBranding();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [waUnreadCount, setWaUnreadCount] = useState(0);
  const [waUnreadConvs, setWaUnreadConvs] = useState(0);
  const lastNotificationIdRef = useRef<string | null>(null);
  const initializedNotificationsRef = useRef(false);
  const unreadCountRef = useRef(0);
  const { playNotificationSound } = useNotificationSound();
  const chatUnread = useChatUnreadDetailed((_prev, _next) => { void playNotificationSound(); });
  const chatUnreadCount = chatUnread.total;
  const chatUnreadConvs = chatUnread.conversations;

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      lastNotificationIdRef.current = null;
      initializedNotificationsRef.current = false;
      return;
    }

    let cancelled = false;

    const fetchUnread = async () => {
      const [{ count }, { data: latestUnread }] = await Promise.all([
        supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('read', false),
        supabase
          .from('notifications')
          .select('id, created_at')
          .eq('user_id', user.id)
          .eq('read', false)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);

      if (cancelled) return;

      const nextUnreadCount = count || 0;
      const previousUnreadCount = unreadCountRef.current;
      setUnreadCount(nextUnreadCount);
      unreadCountRef.current = nextUnreadCount;

      const latestNotificationId = latestUnread?.[0]?.id ?? null;
      if (
        initializedNotificationsRef.current
        && (
          (latestNotificationId && latestNotificationId !== lastNotificationIdRef.current)
          || nextUnreadCount > previousUnreadCount
        )
      ) {
        void playNotificationSound();
      }

      lastNotificationIdRef.current = latestNotificationId;
      initializedNotificationsRef.current = true;
    };

    const handleNotificationsChanged = () => {
      void fetchUnread();
    };

    void fetchUnread();
    window.addEventListener('notifications-changed', handleNotificationsChanged);
    const interval = setInterval(fetchUnread, 30000);

    // Realtime: nova notificação chega imediatamente ao usuário
    const ch = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => { void fetchUnread(); })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => { void fetchUnread(); })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => { void fetchUnread(); })
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener('notifications-changed', handleNotificationsChanged);
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
  }, [user, playNotificationSound]);

  // WhatsApp unread count badge
  useEffect(() => {
    if (!user || !tenantId) { setWaUnreadCount(0); return; }
    let cancelled = false;
    const fetchWa = async () => {
      const { data } = await supabase
        .from('wa_conversations')
        .select('unread_count, status, archived_at')
        .eq('tenant_id', tenantId)
        .neq('status', 'finalizado')
        .is('archived_at', null);
      if (cancelled) return;
      const list = data || [];
      const total = list.reduce((acc: number, c: any) => acc + (c.unread_count || 0), 0);
      const convs = list.filter((c: any) => (c.unread_count || 0) > 0).length;
      setWaUnreadCount(total);
      setWaUnreadConvs(convs);
    };
    void fetchWa();
    const ch = supabase
      .channel(`wa-unread-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_conversations', filter: `tenant_id=eq.${tenantId}` },
        () => { void fetchWa(); })
      .subscribe();
    const interval = setInterval(fetchWa, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(ch);
    };
  }, [user, tenantId]);

  // Update browser tab title with number of distinct senders/conversations with unread messages.
  useEffect(() => {
    const baseTitle = branding?.app_name || 'Hub HelpDesk';
    const senders = (waUnreadConvs || 0) + (chatUnreadConvs || 0);
    document.title = senders > 0 ? `(${senders}) ${baseTitle}` : baseTitle;
    return () => { document.title = baseTitle; };
  }, [waUnreadConvs, chatUnreadConvs, branding?.app_name]);



  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'tickets', label: 'Chamados', icon: Ticket },
    ...(isEnabled('central_atendimento')
      ? [{ id: 'central-atendimento', label: 'Central de Atendimento', icon: Headset, badge: waUnreadCount + chatUnreadCount }]
      : [{ id: 'chat', label: 'Chat', icon: MessageCircle, badge: chatUnreadCount }]),
    ...(isEnabled('central_atendimento') && isAdmin
      ? [{ id: 'atendimento-dashboard', label: 'Dashboard Atendimento', icon: BarChart3 }]
      : []),
    ...(isEnabled('central_atendimento')
      ? [
          { id: 'message-templates', label: 'Mensagens Prontas', icon: MessageSquareText },
          { id: 'scheduled-messages', label: 'Mensagens Agendadas', icon: CalendarClock },
        ]
      : []),
    ...(isEnabled('work_links') ? [{ id: 'work', label: 'Trabalho', icon: Briefcase }] : []),
    { id: 'tasks', label: 'Tarefas', icon: Kanban },
    { id: 'agenda', label: 'Minha Agenda', icon: CalendarClock },
    ...(isAdmin ? [{ id: 'users', label: 'Usuários', icon: Users }] : []),
    ...(isAdmin && isEnabled('password_vault')
      ? [{ id: 'passwords', label: 'Cofre de Senhas', icon: KeyRound }] : []),
    ...(isEnabled('ramais') ? [{ id: 'ramais', label: 'Ramais', icon: Phone }] : []),
    ...(isEnabled('knowledge_base')
      ? [{ id: 'knowledge', label: 'Base de Conhecimento', icon: BookOpen }] : []),
    ...(isEnabled('pdf_to_ofx')
      ? [{ id: 'pdftoofx', label: 'PDF → OFX', icon: FileSpreadsheet }] : []),
    ...(isAdmin && isEnabled('bank_statement')
      ? [{ id: 'bank-statement', label: 'Extrato Bancário', icon: Landmark }] : []),
    ...(isEnabled('document_converter')
      ? [{ id: 'docconverter', label: 'Conversor de Documentos', icon: FileCog }] : []),
    ...(isEnabled('consulta_xml')
      ? [{ id: 'consulta-xml', label: 'Consulta XML', icon: FileCode2 }] : []),
    { id: 'notifications', label: 'Notificações', icon: Bell, badge: unreadCount },
    ...(isAdmin ? [{ id: 'settings', label: 'Configurações', icon: Settings2 }] : []),
    ...(isTenantAdmin ? [{ id: 'billing', label: 'Faturamento', icon: DollarSign }] : []),
    ...(isPlatformAdmin ? [{ id: 'superadmin', label: 'Super Admin', icon: Shield }] : []),
  ];

  const pageTitle = navItems.find(i => i.id === currentPage)?.label || 'Dashboard';

  const roleLabel = user?.role === 'admin' ? 'Administrador' : user?.role === 'supervisor' ? 'Supervisor' : 'Usuário';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col transition-all duration-300 ease-in-out shrink-0 relative z-10 bg-sidebar border-r border-sidebar-border',
          sidebarOpen ? 'w-[260px]' : 'w-0'
        )}
        style={{ overflow: sidebarOpen ? 'visible' : 'hidden' }}
      >
        {/* Logo area */}
        <div className="flex items-center gap-3 px-6 py-7">
          <div className="h-10 w-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-sidebar-accent/30">
            <img
              src={branding?.logo_url || logoHub}
              alt={branding?.app_name || 'Hub HelpDesk'}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="overflow-hidden">
            <h2 className="text-[14px] font-bold text-sidebar-foreground tracking-tight truncate">
              {branding?.app_name || 'Hub HelpDesk'}
            </h2>
            <p className="text-[11px] text-sidebar-foreground/50 truncate">{user?.name}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-5 h-px bg-sidebar-border" />

        {/* Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-1 scrollbar-thin">
          <p className="px-3 mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-sidebar-foreground/35">Menu</p>
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                currentPage === item.id
                  ? 'bg-sidebar-accent text-sidebar-foreground shadow-sm'
                  : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/90'
              )}
            >
              <item.icon className={cn(
                "h-[18px] w-[18px] shrink-0",
                currentPage === item.id ? "text-sidebar-primary" : "text-sidebar-foreground/70"
              )} strokeWidth={1.8} />
              <span className="truncate">{item.label}</span>
              {'badge' in item && item.badge ? (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1.5">
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        {/* User / Logout */}
        <div className="px-4 pb-5">
          <div className="mx-1 h-px bg-sidebar-border mb-4" />
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/80 transition-all duration-200"
          >
            <LogOut className="h-[18px] w-[18px] text-sidebar-foreground/60" strokeWidth={1.8} />
            Sair
          </button>
        </div>

        {/* Collapse button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute -right-3 top-8 flex h-6 w-6 items-center justify-center rounded-full bg-card border border-border shadow-md text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border bg-card/90 backdrop-blur-md px-8 h-[60px] shrink-0">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h1 className="text-[16px] font-semibold text-foreground tracking-tight">{pageTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Modo escuro' : 'Modo claro'}
            >
              {theme === 'light' ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
            </Button>
            <div className="text-right hidden sm:block">
              <p className="text-[13px] font-medium text-foreground">{user?.name}</p>
              <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
            </div>
            <UserProfileMenu />
          </div>
        </header>

        {/* Banner de cobrança */}
        {isTenantAdmin && (billingStatus === 'aguardando_pagamento' || billingStatus === 'atrasado' || billingStatus === 'suspenso') && currentPage !== 'billing' && (
          <div
            className={cn(
              'flex items-center justify-between gap-3 px-6 py-2 text-sm border-b cursor-pointer',
              billingStatus === 'suspenso' ? 'bg-destructive text-destructive-foreground' : 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30'
            )}
            onClick={() => onNavigate('billing')}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>
                {billingStatus === 'suspenso'
                  ? 'Conta suspensa por falta de pagamento. Regularize para liberar o acesso.'
                  : openInvoice
                  ? `Você tem uma fatura ${billingStatus === 'atrasado' ? 'vencida' : 'em aberto'} (vence em ${new Date(openInvoice.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}).`
                  : 'Há pendências no faturamento da sua conta.'}
              </span>
            </div>
            <Button size="sm" variant={billingStatus === 'suspenso' ? 'secondary' : 'outline'}>Ver fatura</Button>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-8 max-w-[1440px] mx-auto">
            {billingStatus === 'suspenso' && currentPage !== 'billing' && currentPage !== 'settings' ? (
              <div className="max-w-xl mx-auto mt-12 text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
                <h2 className="text-2xl font-bold">Acesso suspenso</h2>
                <p className="text-muted-foreground">
                  Sua conta está suspensa por falta de pagamento. Acesse o faturamento para regularizar.
                </p>
                <Button onClick={() => onNavigate('billing')}>Ir para Faturamento</Button>
              </div>
            ) : children}
          </div>
        </main>
      </div>
    </div>
  );
}
