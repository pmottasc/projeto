
-- Pages (hierarchical, Notion-like)
CREATE TABLE public.kb_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parent_id uuid REFERENCES public.kb_pages(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Sem título',
  icon text NOT NULL DEFAULT '',
  cover_url text NOT NULL DEFAULT '',
  is_database boolean NOT NULL DEFAULT false,
  database_view text NOT NULL DEFAULT 'list',
  position integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_pages_tenant ON public.kb_pages(tenant_id);
CREATE INDEX idx_kb_pages_parent ON public.kb_pages(parent_id);

-- Blocks
CREATE TABLE public.kb_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL REFERENCES public.kb_pages(id) ON DELETE CASCADE,
  parent_block_id uuid REFERENCES public.kb_blocks(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'text',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_blocks_page ON public.kb_blocks(page_id);

-- Property definitions (per database page)
CREATE TABLE public.kb_page_property_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  database_page_id uuid NOT NULL REFERENCES public.kb_pages(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_propdefs_db ON public.kb_page_property_defs(database_page_id);

-- Property values
CREATE TABLE public.kb_page_property_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL REFERENCES public.kb_pages(id) ON DELETE CASCADE,
  property_def_id uuid NOT NULL REFERENCES public.kb_page_property_defs(id) ON DELETE CASCADE,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(page_id, property_def_id)
);
CREATE INDEX idx_kb_propvals_page ON public.kb_page_property_values(page_id);

-- RLS
ALTER TABLE public.kb_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_page_property_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_page_property_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY kbp_select ON public.kb_pages FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));
CREATE POLICY kbp_manage ON public.kb_pages FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY kbb_select ON public.kb_blocks FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));
CREATE POLICY kbb_manage ON public.kb_blocks FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY kbpd_select ON public.kb_page_property_defs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));
CREATE POLICY kbpd_manage ON public.kb_page_property_defs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY kbpv_select ON public.kb_page_property_values FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()));
CREATE POLICY kbpv_manage ON public.kb_page_property_values FOR ALL TO authenticated
  USING (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()) AND user_is_tenant_admin(auth.uid(), tenant_id));

-- updated_at triggers
CREATE TRIGGER kb_pages_updated BEFORE UPDATE ON public.kb_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER kb_blocks_updated BEFORE UPDATE ON public.kb_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate existing articles -> pages + blocks
DO $$
DECLARE
  art RECORD;
  stp RECORD;
  new_page_id uuid;
  pos int;
BEGIN
  FOR art IN SELECT * FROM public.kb_articles LOOP
    INSERT INTO public.kb_pages (tenant_id, title, icon, created_by, position)
    VALUES (art.tenant_id, art.title, '📄', art.created_by, 0)
    RETURNING id INTO new_page_id;

    pos := 0;
    IF COALESCE(art.summary, '') <> '' THEN
      INSERT INTO public.kb_blocks (tenant_id, page_id, type, content, position)
      VALUES (art.tenant_id, new_page_id, 'callout', jsonb_build_object('text', art.summary, 'emoji', '💡'), pos);
      pos := pos + 1;
    END IF;

    FOR stp IN SELECT * FROM public.kb_article_steps WHERE article_id = art.id ORDER BY step_number LOOP
      IF COALESCE(stp.title, '') <> '' THEN
        INSERT INTO public.kb_blocks (tenant_id, page_id, type, content, position)
        VALUES (art.tenant_id, new_page_id, 'h2', jsonb_build_object('text', stp.title), pos);
        pos := pos + 1;
      END IF;
      IF COALESCE(stp.content, '') <> '' THEN
        INSERT INTO public.kb_blocks (tenant_id, page_id, type, content, position)
        VALUES (art.tenant_id, new_page_id, 'text', jsonb_build_object('text', stp.content), pos);
        pos := pos + 1;
      END IF;
      IF stp.image_path IS NOT NULL THEN
        INSERT INTO public.kb_blocks (tenant_id, page_id, type, content, position)
        VALUES (art.tenant_id, new_page_id, 'image', jsonb_build_object('path', stp.image_path), pos);
        pos := pos + 1;
      END IF;
      IF stp.video_url IS NOT NULL THEN
        INSERT INTO public.kb_blocks (tenant_id, page_id, type, content, position)
        VALUES (art.tenant_id, new_page_id, 'video', jsonb_build_object('url', stp.video_url), pos);
        pos := pos + 1;
      END IF;
    END LOOP;
  END LOOP;
END $$;
