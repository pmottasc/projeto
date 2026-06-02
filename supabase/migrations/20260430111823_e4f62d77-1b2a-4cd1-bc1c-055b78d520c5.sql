ALTER TABLE public.accounting_api_config 
ADD COLUMN IF NOT EXISTS provider_type text NOT NULL DEFAULT 'custom';

COMMENT ON COLUMN public.accounting_api_config.provider_type IS 'Tipo de provedor: acessorias | custom. Define a lógica de busca/parser.';

-- Set defaults best-suited for Acessorias for new installs
UPDATE public.accounting_api_config 
SET base_url = 'https://api.acessorias.com',
    auth_header_name = 'Authorization',
    auth_header_prefix = 'Bearer ',
    provider_type = 'acessorias'
WHERE base_url = '' OR base_url IS NULL;