ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS tipo_servico text;
CREATE INDEX IF NOT EXISTS idx_tasks_tipo_servico ON public.tasks(tipo_servico) WHERE tipo_servico IS NOT NULL;