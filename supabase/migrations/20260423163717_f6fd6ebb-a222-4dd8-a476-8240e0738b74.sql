
ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'em_atendimento';
ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'aguardando';
ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'resolvido';
ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'fechado';
ALTER TYPE public.urgency_level ADD VALUE IF NOT EXISTS 'critica';
