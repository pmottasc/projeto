import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface NotificationRow {
  id: string; user_id: string; message: string; ticket_id: string; read: boolean; created_at: string;
}

interface NotificationsProps {
  onOpenTicket: (ticketId: string) => void;
}

export default function Notifications({ onOpenTicket }: NotificationsProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  const emitNotificationsChanged = () => { window.dispatchEvent(new CustomEvent('notifications-changed')); };

  const fetchNotifications = async () => {
    if (!user) return;
    const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setNotifications((data as NotificationRow[]) || []);
  };

  useEffect(() => { fetchNotifications(); }, [user]);

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    emitNotificationsChanged();
    fetchNotifications();
  };

  const openNotificationTicket = async (notification: NotificationRow) => {
    if (!user || !notification.ticket_id) return;
    if (!notification.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', notification.id).eq('user_id', user.id);
      emitNotificationsChanged();
      setNotifications(current => current.map(item => item.id === notification.id ? { ...item, read: true } : item));
    }
    onOpenTicket(notification.ticket_id);
  };

  const deleteNotification = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!user) return;
    setNotifications(current => current.filter(n => n.id !== id));
    const { error } = await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
    if (error) { toast.error('Erro ao excluir'); fetchNotifications(); return; }
    emitNotificationsChanged();
  };

  const deleteAll = async () => {
    if (!user || notifications.length === 0) return;
    if (!confirm('Excluir todas as notificações?')) return;
    setNotifications([]);
    const { error } = await supabase.from('notifications').delete().eq('user_id', user.id);
    if (error) { toast.error('Erro ao excluir'); fetchNotifications(); return; }
    emitNotificationsChanged();
    toast.success('Notificações excluídas');
  };

  useEffect(() => {
    return () => {
      if (user) {
        supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
        emitNotificationsChanged();
      }
    };
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight">Notificações</h1>
          <p className="text-[13px] text-muted-foreground mt-1">{unreadCount} não lida(s)</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" className="h-10 text-[13px]" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4 mr-2" /> Marcar todas como lidas
          </Button>
        )}
        {notifications.length > 0 && (
          <Button variant="outline" className="h-10 text-[13px] text-destructive hover:text-destructive" onClick={deleteAll}>
            <Trash2 className="h-4 w-4 mr-2" /> Excluir todas
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl border overflow-hidden" style={{ borderColor: 'hsl(220 15% 90% / 0.7)' }}>
        {notifications.length === 0 ? (
          <div className="py-20 text-center">
            <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-4">
              <Bell className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-[14px] text-muted-foreground font-medium">Nenhuma notificação</p>
            <p className="text-[12px] text-muted-foreground/60 mt-1">Você será notificado sobre atualizações nos chamados</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'hsl(220 15% 90% / 0.5)' }}>
            {notifications.map(n => (
              <div
                key={n.id}
                className={`flex items-start gap-4 px-6 py-4 transition-colors duration-200 ${n.ticket_id ? 'cursor-pointer hover:bg-accent/40' : ''} ${!n.read ? 'bg-primary/[0.02]' : ''}`}
                onClick={() => n.ticket_id && openNotificationTicket(n)}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl shrink-0 mt-0.5 ${!n.read ? 'bg-primary/10' : 'bg-muted/60'}`}>
                  <Bell className={`h-4 w-4 ${!n.read ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] leading-relaxed ${!n.read ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{n.message}</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-1.5 tabular-nums">{new Date(n.created_at).toLocaleString('pt-BR')}</p>
                </div>
                {!n.read && <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0 mt-2.5" />}
                <button
                  onClick={(e) => deleteNotification(e, n.id)}
                  className="opacity-60 hover:opacity-100 hover:text-destructive transition-opacity p-1 -m-1 shrink-0"
                  title="Excluir notificação"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
