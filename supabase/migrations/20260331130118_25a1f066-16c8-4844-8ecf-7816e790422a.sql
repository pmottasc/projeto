
-- KB Categories
CREATE TABLE public.kb_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kb_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view categories" ON public.kb_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/TI can manage categories" ON public.kb_categories FOR ALL TO authenticated USING (is_admin_or_ti(auth.uid())) WITH CHECK (is_admin_or_ti(auth.uid()));

-- KB Articles
CREATE TABLE public.kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  category_id uuid REFERENCES public.kb_categories(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kb_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view articles" ON public.kb_articles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/TI can manage articles" ON public.kb_articles FOR ALL TO authenticated USING (is_admin_or_ti(auth.uid())) WITH CHECK (is_admin_or_ti(auth.uid()));

CREATE TRIGGER update_kb_articles_updated_at BEFORE UPDATE ON public.kb_articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- KB Article Steps
CREATE TABLE public.kb_article_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.kb_articles(id) ON DELETE CASCADE,
  step_number integer NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  image_path text,
  video_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kb_article_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view steps" ON public.kb_article_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin/TI can manage steps" ON public.kb_article_steps FOR ALL TO authenticated USING (is_admin_or_ti(auth.uid())) WITH CHECK (is_admin_or_ti(auth.uid()));

-- Storage bucket for KB media
INSERT INTO storage.buckets (id, name, public) VALUES ('kb-media', 'kb-media', true);

-- Storage policies for kb-media
CREATE POLICY "Anyone can view kb media" ON storage.objects FOR SELECT USING (bucket_id = 'kb-media');
CREATE POLICY "Admin/TI can upload kb media" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'kb-media' AND is_admin_or_ti(auth.uid()));
CREATE POLICY "Admin/TI can delete kb media" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'kb-media' AND is_admin_or_ti(auth.uid()));

-- Add requested_for column to tickets
ALTER TABLE public.tickets ADD COLUMN requested_for uuid;

-- Update tickets SELECT policy: users can also see tickets where they are requested_for
DROP POLICY IF EXISTS "Users can view own tickets" ON public.tickets;
CREATE POLICY "Users can view own tickets" ON public.tickets FOR SELECT TO authenticated USING (auth.uid() = created_by OR auth.uid() = requested_for);

-- Update tickets INSERT policy to allow setting requested_for
DROP POLICY IF EXISTS "Users can create tickets" ON public.tickets;
CREATE POLICY "Users can create tickets" ON public.tickets FOR INSERT TO authenticated WITH CHECK ((auth.uid() = created_by) OR is_admin_or_ti(auth.uid()));
