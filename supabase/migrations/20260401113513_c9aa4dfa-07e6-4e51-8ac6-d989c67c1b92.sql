
CREATE TYPE public.ramal_status AS ENUM ('ativo', 'manutencao', 'inativo');

CREATE TABLE public.ramais (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  numero TEXT NOT NULL,
  colaborador TEXT NOT NULL DEFAULT '',
  status ramal_status NOT NULL DEFAULT 'ativo',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ramais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view ramais" ON public.ramais FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/TI can manage ramais" ON public.ramais FOR ALL TO authenticated USING (is_admin_or_ti(auth.uid())) WITH CHECK (is_admin_or_ti(auth.uid()));
