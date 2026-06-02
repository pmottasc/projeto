import { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Login from './Login';
import AppLayout from '@/components/AppLayout';
import { Loader2 } from 'lucide-react';

// Code-splitting: cada página vira um chunk separado, reduzindo o bundle inicial.
const Dashboard            = lazy(() => import('./Dashboard'));
const Tickets              = lazy(() => import('./Tickets'));
const UsersPage            = lazy(() => import('./UsersPage'));
const Notifications        = lazy(() => import('./Notifications'));
const PasswordsVault       = lazy(() => import('./PasswordsVault'));
const KnowledgeBase        = lazy(() => import('./KnowledgeBase'));
const Ramais               = lazy(() => import('./Ramais'));
const PdfToOfx             = lazy(() => import('./PdfToOfx'));
const DocumentConverter    = lazy(() => import('./DocumentConverter'));
const SuperAdmin           = lazy(() => import('./SuperAdmin'));
const Chat                 = lazy(() => import('./Chat'));
const Work                 = lazy(() => import('./Work'));
const CentralAtendimento   = lazy(() => import('./CentralAtendimento'));
const Tasks                = lazy(() => import('./Tasks'));
const AtendimentoDashboard = lazy(() => import('./AtendimentoDashboard'));
const Settings             = lazy(() => import('./Settings'));
const Billing              = lazy(() => import('./Billing'));
const BankStatement        = lazy(() => import('./BankStatement'));
const MessageTemplates     = lazy(() => import('./MessageTemplates'));
const ScheduledMessages    = lazy(() => import('./ScheduledMessages'));
const ConsultaXml          = lazy(() => import('./ConsultaXml'));
const Agenda               = lazy(() => import('./Agenda'));

const PAGE_STORAGE_KEY = 'hub:current_page';

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

export default function Index() {
  const { user, loading } = useAuth();
  const [currentPage, setCurrentPageState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    return localStorage.getItem(PAGE_STORAGE_KEY) || 'dashboard';
  });
  const [ticketToOpenId, setTicketToOpenId] = useState<string | null>(null);

  const setCurrentPage = (page: string) => {
    setCurrentPageState(page);
    try { localStorage.setItem(PAGE_STORAGE_KEY, page); } catch { /* ignore */ }
  };

  useEffect(() => { setTicketToOpenId(null); }, [user?.id]);

  const handleOpenTicketFromNotification = (ticketId: string) => {
    setTicketToOpenId(ticketId);
    setCurrentPage('tickets');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Login />;

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':            return <Dashboard onOpenTicket={handleOpenTicketFromNotification} />;
      case 'tickets':              return <Tickets ticketToOpenId={ticketToOpenId} onTicketOpened={() => setTicketToOpenId(null)} />;
      case 'users':                return <UsersPage />;
      case 'notifications':        return <Notifications onOpenTicket={handleOpenTicketFromNotification} />;
      case 'passwords':            return <PasswordsVault />;
      case 'knowledge':            return <KnowledgeBase />;
      case 'ramais':               return <Ramais />;
      case 'pdftoofx':             return <PdfToOfx />;
      case 'docconverter':         return <DocumentConverter />;
      case 'superadmin':           return <SuperAdmin />;
      case 'chat':                 return <Chat />;
      case 'work':                 return <Work />;
      case 'tasks':                return <Tasks />;
      case 'central-atendimento':  return <CentralAtendimento />;
      case 'atendimento-dashboard':return <AtendimentoDashboard />;
      case 'settings':             return <Settings />;
      case 'billing':              return <Billing />;
      case 'bank-statement':       return <BankStatement />;
      case 'message-templates':    return <MessageTemplates />;
      case 'scheduled-messages':   return <ScheduledMessages />;
      case 'consulta-xml':         return <ConsultaXml />;
      case 'agenda':               return <Agenda />;
      default:                     return <Dashboard />;
    }
  };

  return (
    <AppLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      <Suspense fallback={<PageFallback />}>
        {renderPage()}
      </Suspense>
    </AppLayout>
  );
}
