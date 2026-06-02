export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      accounting_api_config: {
        Row: {
          active: boolean
          api_token: string
          auth_header_name: string
          auth_header_prefix: string
          base_url: string
          created_at: string
          endpoint_template: string
          extra_config: Json
          id: string
          provider_name: string
          provider_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          api_token?: string
          auth_header_name?: string
          auth_header_prefix?: string
          base_url?: string
          created_at?: string
          endpoint_template?: string
          extra_config?: Json
          id?: string
          provider_name?: string
          provider_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          api_token?: string
          auth_header_name?: string
          auth_header_prefix?: string
          base_url?: string
          created_at?: string
          endpoint_template?: string
          extra_config?: Json
          id?: string
          provider_name?: string
          provider_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: string
          metadata: Json
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string
          metadata?: Json
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string
          metadata?: Json
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string
          account_type: string
          active: boolean
          agency: string
          bank_code: string
          bank_name: string
          company_id: string
          created_at: string
          created_by: string
          default_credit_account: string
          default_debit_account: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number?: string
          account_type?: string
          active?: boolean
          agency?: string
          bank_code?: string
          bank_name: string
          company_id: string
          created_at?: string
          created_by: string
          default_credit_account?: string
          default_debit_account?: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string
          account_type?: string
          active?: boolean
          agency?: string
          bank_code?: string
          bank_name?: string
          company_id?: string
          created_at?: string
          created_by?: string
          default_credit_account?: string
          default_debit_account?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "bank_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_companies: {
        Row: {
          active: boolean
          cnpj: string
          created_at: string
          created_by: string
          id: string
          name: string
          tenant_id: string
          trade_name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cnpj?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          tenant_id: string
          trade_name?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cnpj?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          tenant_id?: string
          trade_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      bank_statement_export_logs: {
        Row: {
          created_at: string
          export_type: string
          file_name: string
          id: string
          import_id: string | null
          tenant_id: string
          total_records: number
          user_id: string
        }
        Insert: {
          created_at?: string
          export_type: string
          file_name: string
          id?: string
          import_id?: string | null
          tenant_id: string
          total_records?: number
          user_id: string
        }
        Update: {
          created_at?: string
          export_type?: string
          file_name?: string
          id?: string
          import_id?: string | null
          tenant_id?: string
          total_records?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_export_logs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_imports: {
        Row: {
          bank_account_id: string | null
          company_id: string | null
          created_at: string
          error_records: number
          file_hash: string
          file_name: string
          file_type: string
          finished_at: string | null
          fixed_rules: Json
          id: string
          imported_records: number
          pending_records: number
          period_end: string | null
          period_start: string | null
          started_at: string
          status: string
          tenant_id: string
          total_records: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_account_id?: string | null
          company_id?: string | null
          created_at?: string
          error_records?: number
          file_hash?: string
          file_name: string
          file_type: string
          finished_at?: string | null
          fixed_rules?: Json
          id?: string
          imported_records?: number
          pending_records?: number
          period_end?: string | null
          period_start?: string | null
          started_at?: string
          status?: string
          tenant_id: string
          total_records?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_account_id?: string | null
          company_id?: string | null
          created_at?: string
          error_records?: number
          file_hash?: string
          file_name?: string
          file_type?: string
          finished_at?: string | null
          fixed_rules?: Json
          id?: string
          imported_records?: number
          pending_records?: number
          period_end?: string | null
          period_start?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
          total_records?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_imports_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "bank_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_mapping_templates: {
        Row: {
          bank_name: string
          company_id: string | null
          created_at: string
          created_by: string
          date_format: string
          decimal_format: string
          delimiter: string
          file_type: string
          id: string
          mapping_config: Json
          start_line: number
          template_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bank_name?: string
          company_id?: string | null
          created_at?: string
          created_by: string
          date_format?: string
          decimal_format?: string
          delimiter?: string
          file_type?: string
          id?: string
          mapping_config?: Json
          start_line?: number
          template_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bank_name?: string
          company_id?: string | null
          created_at?: string
          created_by?: string
          date_format?: string
          decimal_format?: string
          delimiter?: string
          file_type?: string
          id?: string
          mapping_config?: Json
          start_line?: number
          template_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_mapping_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "bank_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_rules: {
        Row: {
          accounting_history: string
          active: boolean
          bank_account_id: string | null
          category: string
          company_id: string | null
          cost_center: string
          created_at: string
          created_by: string
          credit_account: string
          debit_account: string
          id: string
          keyword: string
          match_type: string
          priority: number
          tenant_id: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          accounting_history?: string
          active?: boolean
          bank_account_id?: string | null
          category?: string
          company_id?: string | null
          cost_center?: string
          created_at?: string
          created_by: string
          credit_account?: string
          debit_account?: string
          id?: string
          keyword: string
          match_type?: string
          priority?: number
          tenant_id: string
          transaction_type?: string
          updated_at?: string
        }
        Update: {
          accounting_history?: string
          active?: boolean
          bank_account_id?: string | null
          category?: string
          company_id?: string | null
          cost_center?: string
          created_at?: string
          created_by?: string
          credit_account?: string
          debit_account?: string
          id?: string
          keyword?: string
          match_type?: string
          priority?: number
          tenant_id?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_rules_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "bank_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_transactions: {
        Row: {
          accounting_history: string
          amount: number
          balance: number | null
          category: string
          checked: boolean
          company_id: string | null
          cost_center: string
          created_at: string
          credit_account: string
          debit_account: string
          description: string
          document_number: string
          id: string
          ignored: boolean
          import_id: string
          matched_rule_id: string | null
          raw_data: Json
          status: string
          tenant_id: string
          transaction_date: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          accounting_history?: string
          amount?: number
          balance?: number | null
          category?: string
          checked?: boolean
          company_id?: string | null
          cost_center?: string
          created_at?: string
          credit_account?: string
          debit_account?: string
          description?: string
          document_number?: string
          id?: string
          ignored?: boolean
          import_id: string
          matched_rule_id?: string | null
          raw_data?: Json
          status?: string
          tenant_id: string
          transaction_date: string
          transaction_type?: string
          updated_at?: string
        }
        Update: {
          accounting_history?: string
          amount?: number
          balance?: number | null
          category?: string
          checked?: boolean
          company_id?: string | null
          cost_center?: string
          created_at?: string
          credit_account?: string
          debit_account?: string
          description?: string
          document_number?: string
          id?: string
          ignored?: boolean
          import_id?: string
          matched_rule_id?: string | null
          raw_data?: Json
          status?: string
          tenant_id?: string
          transaction_date?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "bank_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_transactions_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          tenant_id: string
          type: Database["public"]["Enums"]["chat_conversation_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name?: string
          tenant_id: string
          type?: Database["public"]["Enums"]["chat_conversation_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          tenant_id?: string
          type?: Database["public"]["Enums"]["chat_conversation_type"]
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          forwarded_from: string | null
          id: string
          reply_to_id: string | null
          sender_id: string
          tenant_id: string
          type: Database["public"]["Enums"]["chat_message_type"]
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          content?: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_from?: string | null
          id?: string
          reply_to_id?: string | null
          sender_id: string
          tenant_id: string
          type?: Database["public"]["Enums"]["chat_message_type"]
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          forwarded_from?: string | null
          id?: string
          reply_to_id?: string | null
          sender_id?: string
          tenant_id?: string
          type?: Database["public"]["Enums"]["chat_message_type"]
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_forwarded_from_fkey"
            columns: ["forwarded_from"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participants: {
        Row: {
          archived_at: string | null
          conversation_id: string
          hidden_at: string | null
          id: string
          is_admin: boolean
          joined_at: string
          last_read_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          conversation_id: string
          hidden_at?: string | null
          id?: string
          is_admin?: boolean
          joined_at?: string
          last_read_at?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          conversation_id?: string
          hidden_at?: string | null
          id?: string
          is_admin?: boolean
          joined_at?: string
          last_read_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_presence: {
        Row: {
          last_seen_at: string
          manual_status:
            | Database["public"]["Enums"]["chat_presence_status"]
            | null
          status: Database["public"]["Enums"]["chat_presence_status"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          manual_status?:
            | Database["public"]["Enums"]["chat_presence_status"]
            | null
          status?: Database["public"]["Enums"]["chat_presence_status"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          manual_status?:
            | Database["public"]["Enums"]["chat_presence_status"]
            | null
          status?: Database["public"]["Enums"]["chat_presence_status"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chatbot_agent_memory: {
        Row: {
          contact_id: string
          created_at: string
          facts: Json
          id: string
          profile: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          facts?: Json
          id?: string
          profile?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          facts?: Json
          id?: string
          profile?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_agent_memory_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_edges: {
        Row: {
          created_at: string
          flow_id: string
          id: string
          label: string
          source_handle: string
          source_node_id: string
          target_node_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          flow_id: string
          id?: string
          label?: string
          source_handle?: string
          source_node_id: string
          target_node_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          flow_id?: string
          id?: string
          label?: string
          source_handle?: string
          source_node_id?: string
          target_node_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_edges_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "chatbot_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_edges_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "chatbot_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chatbot_edges_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "chatbot_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_flows: {
        Row: {
          active: boolean
          agent_api_base_url: string | null
          agent_api_key: string | null
          agent_api_provider: string
          agent_handoff_keywords: string[]
          agent_max_tokens: number
          agent_model: string
          agent_persona: string
          agent_tools: string[]
          created_at: string
          created_by: string
          description: string
          id: string
          inactivity_handoff_department_id: string | null
          inactivity_timeout_enabled: boolean
          inactivity_timeout_minutes: number
          mode: string
          name: string
          tenant_id: string
          trigger_keywords: string[]
          trigger_kind: Database["public"]["Enums"]["chatbot_trigger_kind"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_api_base_url?: string | null
          agent_api_key?: string | null
          agent_api_provider?: string
          agent_handoff_keywords?: string[]
          agent_max_tokens?: number
          agent_model?: string
          agent_persona?: string
          agent_tools?: string[]
          created_at?: string
          created_by: string
          description?: string
          id?: string
          inactivity_handoff_department_id?: string | null
          inactivity_timeout_enabled?: boolean
          inactivity_timeout_minutes?: number
          mode?: string
          name: string
          tenant_id: string
          trigger_keywords?: string[]
          trigger_kind?: Database["public"]["Enums"]["chatbot_trigger_kind"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_api_base_url?: string | null
          agent_api_key?: string | null
          agent_api_provider?: string
          agent_handoff_keywords?: string[]
          agent_max_tokens?: number
          agent_model?: string
          agent_persona?: string
          agent_tools?: string[]
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          inactivity_handoff_department_id?: string | null
          inactivity_timeout_enabled?: boolean
          inactivity_timeout_minutes?: number
          mode?: string
          name?: string
          tenant_id?: string
          trigger_keywords?: string[]
          trigger_kind?: Database["public"]["Enums"]["chatbot_trigger_kind"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_flows_inactivity_handoff_department_id_fkey"
            columns: ["inactivity_handoff_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_nodes: {
        Row: {
          config: Json
          created_at: string
          flow_id: string
          id: string
          kind: Database["public"]["Enums"]["chatbot_node_kind"]
          label: string
          position_x: number
          position_y: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          flow_id: string
          id?: string
          kind: Database["public"]["Enums"]["chatbot_node_kind"]
          label?: string
          position_x?: number
          position_y?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          flow_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["chatbot_node_kind"]
          label?: string
          position_x?: number
          position_y?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_nodes_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "chatbot_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbot_sessions: {
        Row: {
          conversation_id: string
          current_node_id: string | null
          ended_at: string | null
          flow_id: string
          id: string
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
          variables: Json
        }
        Insert: {
          conversation_id: string
          current_node_id?: string | null
          ended_at?: string | null
          flow_id: string
          id?: string
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          conversation_id?: string
          current_node_id?: string | null
          ended_at?: string | null
          flow_id?: string
          id?: string
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_sessions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "chatbot_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          bairro: string
          capital_social: number | null
          cep: string
          cnae_principal: string
          cnae_principal_descricao: string
          cnaes_secundarios: Json
          cnpj: string
          complemento: string
          created_at: string
          created_by: string
          data_abertura: string | null
          email: string
          id: string
          logradouro: string
          municipio: string
          natureza_juridica: string
          nome_fantasia: string
          numero: string
          porte: string
          raw_data: Json
          razao_social: string
          situacao: string
          socios: Json
          telefone: string
          tenant_id: string
          uf: string
          updated_at: string
        }
        Insert: {
          bairro?: string
          capital_social?: number | null
          cep?: string
          cnae_principal?: string
          cnae_principal_descricao?: string
          cnaes_secundarios?: Json
          cnpj: string
          complemento?: string
          created_at?: string
          created_by: string
          data_abertura?: string | null
          email?: string
          id?: string
          logradouro?: string
          municipio?: string
          natureza_juridica?: string
          nome_fantasia?: string
          numero?: string
          porte?: string
          raw_data?: Json
          razao_social?: string
          situacao?: string
          socios?: Json
          telefone?: string
          tenant_id: string
          uf?: string
          updated_at?: string
        }
        Update: {
          bairro?: string
          capital_social?: number | null
          cep?: string
          cnae_principal?: string
          cnae_principal_descricao?: string
          cnaes_secundarios?: Json
          cnpj?: string
          complemento?: string
          created_at?: string
          created_by?: string
          data_abertura?: string | null
          email?: string
          id?: string
          logradouro?: string
          municipio?: string
          natureza_juridica?: string
          nome_fantasia?: string
          numero?: string
          porte?: string
          raw_data?: Json
          razao_social?: string
          situacao?: string
          socios?: Json
          telefone?: string
          tenant_id?: string
          uf?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversion_history: {
        Row: {
          bank_detected: string
          created_at: string
          id: string
          reconciliation_ok: boolean
          source_filename: string
          status: string
          tenant_id: string
          total_credits: number
          total_debits: number
          transaction_count: number
          user_id: string
        }
        Insert: {
          bank_detected?: string
          created_at?: string
          id?: string
          reconciliation_ok?: boolean
          source_filename: string
          status?: string
          tenant_id: string
          total_credits?: number
          total_debits?: number
          transaction_count?: number
          user_id: string
        }
        Update: {
          bank_detected?: string
          created_at?: string
          id?: string
          reconciliation_ok?: boolean
          source_filename?: string
          status?: string
          tenant_id?: string
          total_credits?: number
          total_debits?: number
          transaction_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversion_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          active: boolean
          color: string
          created_at: string
          description: string
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          description?: string
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      digital_certificates: {
        Row: {
          certificate_password: string
          cnpj: string
          created_at: string
          created_by: string
          expires_at: string | null
          file_name: string
          file_path: string
          file_size: number
          id: string
          mime_type: string
          name: string
          notes: string
          owner: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          certificate_password?: string
          cnpj?: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          mime_type?: string
          name: string
          notes?: string
          owner?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          certificate_password?: string
          cnpj?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          mime_type?: string
          name?: string
          notes?: string
          owner?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_delivery_log: {
        Row: {
          cnpj: string
          contact_phone: string
          conversation_id: string | null
          created_at: string
          document_type: string
          error_message: string
          file_name: string
          id: string
          status: string
          tenant_id: string
        }
        Insert: {
          cnpj?: string
          contact_phone?: string
          conversation_id?: string | null
          created_at?: string
          document_type?: string
          error_message?: string
          file_name?: string
          id?: string
          status?: string
          tenant_id: string
        }
        Update: {
          cnpj?: string
          contact_phone?: string
          conversation_id?: string | null
          created_at?: string
          document_type?: string
          error_message?: string
          file_name?: string
          id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["tenant_member_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          tenant_id: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          tenant_id: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_article_steps: {
        Row: {
          article_id: string
          content: string
          created_at: string
          id: string
          image_path: string | null
          step_number: number
          tenant_id: string
          title: string
          video_url: string | null
        }
        Insert: {
          article_id: string
          content?: string
          created_at?: string
          id?: string
          image_path?: string | null
          step_number?: number
          tenant_id: string
          title?: string
          video_url?: string | null
        }
        Update: {
          article_id?: string
          content?: string
          created_at?: string
          id?: string
          image_path?: string | null
          step_number?: number
          tenant_id?: string
          title?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kb_article_steps_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "kb_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_article_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_articles: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string
          id: string
          summary: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          summary?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          summary?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "kb_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_articles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_blocks: {
        Row: {
          content: Json
          created_at: string
          id: string
          page_id: string
          parent_block_id: string | null
          position: number
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          page_id: string
          parent_block_id?: string | null
          position?: number
          tenant_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          page_id?: string
          parent_block_id?: string | null
          position?: number
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_blocks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_blocks_parent_block_id_fkey"
            columns: ["parent_block_id"]
            isOneToOne: false
            referencedRelation: "kb_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_page_property_defs: {
        Row: {
          created_at: string
          database_page_id: string
          id: string
          name: string
          options: Json
          position: number
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          database_page_id: string
          id?: string
          name: string
          options?: Json
          position?: number
          tenant_id: string
          type?: string
        }
        Update: {
          created_at?: string
          database_page_id?: string
          id?: string
          name?: string
          options?: Json
          position?: number
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_page_property_defs_database_page_id_fkey"
            columns: ["database_page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_page_property_values: {
        Row: {
          id: string
          page_id: string
          property_def_id: string
          tenant_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          page_id: string
          property_def_id: string
          tenant_id: string
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: string
          page_id?: string
          property_def_id?: string
          tenant_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "kb_page_property_values_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_page_property_values_property_def_id_fkey"
            columns: ["property_def_id"]
            isOneToOne: false
            referencedRelation: "kb_page_property_defs"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_pages: {
        Row: {
          archived_at: string | null
          cover_url: string
          created_at: string
          created_by: string
          database_view: string
          icon: string
          id: string
          is_database: boolean
          parent_id: string | null
          position: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cover_url?: string
          created_at?: string
          created_by: string
          database_view?: string
          icon?: string
          id?: string
          is_database?: boolean
          parent_id?: string | null
          position?: number
          tenant_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cover_url?: string
          created_at?: string
          created_by?: string
          database_view?: string
          icon?: string
          id?: string
          is_database?: boolean
          parent_id?: string | null
          position?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_pages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "kb_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_logs: {
        Row: {
          attachments_count: number
          channel: string
          contact_name: string
          contact_phone: string
          content: string
          created_at: string
          error_message: string
          id: string
          provider_message_id: string
          scheduled_message_id: string | null
          sent_at: string
          sent_by: string | null
          status: string
          template_id: string | null
          tenant_id: string
          ticket_id: string | null
        }
        Insert: {
          attachments_count?: number
          channel?: string
          contact_name?: string
          contact_phone?: string
          content?: string
          created_at?: string
          error_message?: string
          id?: string
          provider_message_id?: string
          scheduled_message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: string
          template_id?: string | null
          tenant_id: string
          ticket_id?: string | null
        }
        Update: {
          attachments_count?: number
          channel?: string
          contact_name?: string
          contact_phone?: string
          content?: string
          created_at?: string
          error_message?: string
          id?: string
          provider_message_id?: string
          scheduled_message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: string
          template_id?: string | null
          tenant_id?: string
          ticket_id?: string | null
        }
        Relationships: []
      }
      message_template_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          id: string
          mime_type: string
          original_file_name: string
          template_id: string
          tenant_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          mime_type: string
          original_file_name: string
          template_id: string
          tenant_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          mime_type?: string
          original_file_name?: string
          template_id?: string
          tenant_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_template_attachments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          active: boolean
          allow_attachments: boolean
          category: string
          channel: string
          content: string
          created_at: string
          created_by: string
          id: string
          requires_review_before_send: boolean
          send_immediately_allowed: boolean
          shortcut: string
          tenant_id: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          active?: boolean
          allow_attachments?: boolean
          category?: string
          channel?: string
          content?: string
          created_at?: string
          created_by: string
          id?: string
          requires_review_before_send?: boolean
          send_immediately_allowed?: boolean
          shortcut: string
          tenant_id: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          active?: boolean
          allow_attachments?: boolean
          category?: string
          channel?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          requires_review_before_send?: boolean
          send_immediately_allowed?: boolean
          shortcut?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          tenant_id: string
          ticket_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          tenant_id: string
          ticket_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          tenant_id?: string
          ticket_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      passwords_vault: {
        Row: {
          created_at: string
          created_by: string
          id: string
          login_email: string
          login_password: string
          login_username: string
          notes: string
          service_name: string
          service_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          login_email?: string
          login_password?: string
          login_username?: string
          notes?: string
          service_name: string
          service_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          login_email?: string
          login_password?: string
          login_username?: string
          notes?: string
          service_name?: string
          service_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "passwords_vault_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          description: string
          features: Json
          id: string
          max_ai_messages_per_month: number
          max_conversions_per_month: number
          max_storage_mb: number
          max_users: number
          name: string
          price_cents: number
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          features?: Json
          id?: string
          max_ai_messages_per_month?: number
          max_conversions_per_month?: number
          max_storage_mb?: number
          max_users?: number
          name: string
          price_cents?: number
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          features?: Json
          id?: string
          max_ai_messages_per_month?: number
          max_conversions_per_month?: number
          max_storage_mb?: number
          max_users?: number
          name?: string
          price_cents?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      processed_emails: {
        Row: {
          error_message: string | null
          id: string
          message_id: string
          processed_at: string
          sender_email: string
          status: string
          subject: string
          tenant_id: string
          ticket_id: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          message_id: string
          processed_at?: string
          sender_email: string
          status?: string
          subject: string
          tenant_id: string
          ticket_id?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          message_id?: string
          processed_at?: string
          sender_email?: string
          status?: string
          subject?: string
          tenant_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processed_emails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processed_emails_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_departments: {
        Row: {
          created_at: string
          department_id: string
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          avatar_url: string | null
          created_at: string
          department_id: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      ramais: {
        Row: {
          colaborador: string
          created_at: string
          created_by: string
          id: string
          numero: string
          status: Database["public"]["Enums"]["ramal_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          colaborador?: string
          created_at?: string
          created_by: string
          id?: string
          numero: string
          status?: Database["public"]["Enums"]["ramal_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          colaborador?: string
          created_at?: string
          created_by?: string
          id?: string
          numero?: string
          status?: Database["public"]["Enums"]["ramal_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ramais_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_message_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          id: string
          mime_type: string
          original_file_name: string
          scheduled_message_id: string
          tenant_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          mime_type: string
          original_file_name: string
          scheduled_message_id: string
          tenant_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          mime_type?: string
          original_file_name?: string
          scheduled_message_id?: string
          tenant_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_message_attachments_scheduled_message_id_fkey"
            columns: ["scheduled_message_id"]
            isOneToOne: false
            referencedRelation: "scheduled_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          attachments: Json
          attempts: number
          canceled_at: string | null
          channel: string
          contact_email: string
          contact_name: string
          contact_phone: string
          content: string
          created_at: string
          created_by: string
          error_message: string
          failed_at: string | null
          id: string
          scheduled_at: string
          sent_at: string | null
          status: string
          subject: string
          template_id: string | null
          tenant_id: string
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json
          attempts?: number
          canceled_at?: string | null
          channel?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          content?: string
          created_at?: string
          created_by: string
          error_message?: string
          failed_at?: string | null
          id?: string
          scheduled_at: string
          sent_at?: string | null
          status?: string
          subject?: string
          template_id?: string | null
          tenant_id: string
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json
          attempts?: number
          canceled_at?: string | null
          channel?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          content?: string
          created_at?: string
          created_by?: string
          error_message?: string
          failed_at?: string | null
          id?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          subject?: string
          template_id?: string | null
          tenant_id?: string
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_policies: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          first_response_minutes: number
          id: string
          name: string
          resolution_minutes: number
          tenant_id: string
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"] | null
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          first_response_minutes?: number
          id?: string
          name: string
          resolution_minutes?: number
          tenant_id: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          first_response_minutes?: number
          id?: string
          name?: string
          resolution_minutes?: number
          tenant_id?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Relationships: [
          {
            foreignKeyName: "sla_policies_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ticket_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          id: string
          period_end: string | null
          period_start: string
          plan_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_end?: string | null
          period_start?: string
          plan_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string | null
          period_start?: string
          plan_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          comentarios: Json
          company_id: string | null
          created_at: string
          criado_por: string
          data_prevista: string | null
          descricao: string
          id: string
          last_status_changed_at: string | null
          last_status_changed_by: string | null
          position: number
          prioridade: string
          responsavel_id: string | null
          status: string
          tenant_id: string
          ticket_id: string | null
          tipo_servico: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          comentarios?: Json
          company_id?: string | null
          created_at?: string
          criado_por: string
          data_prevista?: string | null
          descricao?: string
          id?: string
          last_status_changed_at?: string | null
          last_status_changed_by?: string | null
          position?: number
          prioridade?: string
          responsavel_id?: string | null
          status?: string
          tenant_id: string
          ticket_id?: string | null
          tipo_servico?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          comentarios?: Json
          company_id?: string | null
          created_at?: string
          criado_por?: string
          data_prevista?: string | null
          descricao?: string
          id?: string
          last_status_changed_at?: string | null
          last_status_changed_by?: string | null
          position?: number
          prioridade?: string
          responsavel_id?: string | null
          status?: string
          tenant_id?: string
          ticket_id?: string | null
          tipo_servico?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_billing: {
        Row: {
          billing_day: number
          billing_exempt: boolean
          created_at: string
          id: string
          monthly_amount_cents: number
          next_invoice_date: string | null
          notes: string
          payment_bank_info: string
          payment_instructions: string
          payment_pix_key: string
          plan_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          billing_day?: number
          billing_exempt?: boolean
          created_at?: string
          id?: string
          monthly_amount_cents?: number
          next_invoice_date?: string | null
          notes?: string
          payment_bank_info?: string
          payment_instructions?: string
          payment_pix_key?: string
          plan_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          billing_day?: number
          billing_exempt?: boolean
          created_at?: string
          id?: string
          monthly_amount_cents?: number
          next_invoice_date?: string | null
          notes?: string
          payment_bank_info?: string
          payment_instructions?: string
          payment_pix_key?: string
          plan_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_branding: {
        Row: {
          accent_hsl: string
          app_name: string
          id: string
          logo_path: string
          logo_url: string
          primary_hsl: string
          secondary_hsl: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          use_gradient: boolean
        }
        Insert: {
          accent_hsl?: string
          app_name?: string
          id?: string
          logo_path?: string
          logo_url?: string
          primary_hsl?: string
          secondary_hsl?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          use_gradient?: boolean
        }
        Update: {
          accent_hsl?: string
          app_name?: string
          id?: string
          logo_path?: string
          logo_url?: string
          primary_hsl?: string
          secondary_hsl?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          use_gradient?: boolean
        }
        Relationships: []
      }
      tenant_features: {
        Row: {
          enabled: boolean
          feature_key: string
          id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          id?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_features_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invoices: {
        Row: {
          amount_cents: number
          created_at: string
          due_date: string
          id: string
          marked_paid_by: string | null
          notes: string
          paid_at: string | null
          payment_method: string
          plan_id: string | null
          receipt_url: string
          reference_month: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          due_date: string
          id?: string
          marked_paid_by?: string | null
          notes?: string
          paid_at?: string | null
          payment_method?: string
          plan_id?: string | null
          receipt_url?: string
          reference_month: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          due_date?: string
          id?: string
          marked_paid_by?: string | null
          notes?: string
          paid_at?: string | null
          payment_method?: string
          plan_id?: string | null
          receipt_url?: string
          reference_month?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_member_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_usage_counters: {
        Row: {
          count: number
          counter_key: string
          id: string
          period_month: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          count?: number
          counter_key: string
          id?: string
          period_month: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          count?: number
          counter_key?: string
          id?: string
          period_month?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          contact_email: string
          contact_phone: string
          created_at: string
          id: string
          name: string
          notes: string
          plan_id: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string
          contact_phone?: string
          created_at?: string
          id?: string
          name: string
          notes?: string
          plan_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string
          contact_phone?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string
          plan_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number
          file_type: string
          id?: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          tenant_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_categories: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ticket_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          tenant_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_history: {
        Row: {
          created_at: string
          field: string
          id: string
          new_value: string
          old_value: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          new_value: string
          old_value?: string
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          new_value?: string
          old_value?: string
          tenant_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_history_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_types: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          assignee_id: string | null
          category_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string
          description: string
          first_response_at: string | null
          first_response_due_at: string | null
          id: string
          number: number
          requested_for: string | null
          resolution_due_at: string | null
          resolved_at: string | null
          sla_policy_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          tenant_id: string
          ticket_type_id: string | null
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"]
        }
        Insert: {
          assignee_id?: string | null
          category_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by: string
          description: string
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string
          number?: number
          requested_for?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          sla_policy_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tenant_id: string
          ticket_type_id?: string | null
          title: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Update: {
          assignee_id?: string | null
          category_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string
          number?: number
          requested_for?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          sla_policy_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tenant_id?: string
          ticket_type_id?: string | null
          title?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Relationships: [
          {
            foreignKeyName: "tickets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ticket_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_sla_policy_id_fkey"
            columns: ["sla_policy_id"]
            isOneToOne: false
            referencedRelation: "sla_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      user_agenda_events: {
        Row: {
          all_day: boolean
          color: string | null
          created_at: string
          description: string | null
          end_at: string
          id: string
          location: string | null
          start_at: string
          tenant_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          end_at: string
          id?: string
          location?: string | null
          start_at: string
          tenant_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          end_at?: string
          id?: string
          location?: string | null
          start_at?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          performed_by: string | null
          target_user_id: string
          tenant_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          performed_by?: string | null
          target_user_id: string
          tenant_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          performed_by?: string | null
          target_user_id?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_contact_cnpjs: {
        Row: {
          active: boolean
          cnpj: string
          created_at: string
          external_id: string
          id: string
          notes: string
          phone: string
          razao_social: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cnpj: string
          created_at?: string
          external_id?: string
          id?: string
          notes?: string
          phone: string
          razao_social?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cnpj?: string
          created_at?: string
          external_id?: string
          id?: string
          notes?: string
          phone?: string
          razao_social?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_contacts: {
        Row: {
          avatar_url: string
          blocked: boolean
          created_at: string
          id: string
          name: string
          notes: string
          opt_in: boolean
          opt_in_at: string | null
          phone: string
          tags: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string
          blocked?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string
          opt_in?: boolean
          opt_in_at?: string | null
          phone: string
          tags?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string
          blocked?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string
          opt_in?: boolean
          opt_in_at?: string | null
          phone?: string
          tags?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_conversations: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          bot_paused: boolean
          contact_id: string
          created_at: string
          department_id: string | null
          id: string
          internal_notes: string
          last_message_at: string | null
          last_message_preview: string
          status: Database["public"]["Enums"]["wa_conversation_status"]
          tags: string[]
          tenant_id: string
          ticket_id: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          bot_paused?: boolean
          contact_id: string
          created_at?: string
          department_id?: string | null
          id?: string
          internal_notes?: string
          last_message_at?: string | null
          last_message_preview?: string
          status?: Database["public"]["Enums"]["wa_conversation_status"]
          tags?: string[]
          tenant_id: string
          ticket_id?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          bot_paused?: boolean
          contact_id?: string
          created_at?: string
          department_id?: string | null
          id?: string
          internal_notes?: string
          last_message_at?: string | null
          last_message_preview?: string
          status?: Database["public"]["Enums"]["wa_conversation_status"]
          tags?: string[]
          tenant_id?: string
          ticket_id?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_messages: {
        Row: {
          body: string
          bot_processed_at: string | null
          contact_id: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["wa_message_direction"]
          external_id: string
          id: string
          media_mime: string
          media_name: string
          media_url: string
          metadata: Json
          sender_user_id: string | null
          status: Database["public"]["Enums"]["wa_message_status"]
          tenant_id: string
          type: Database["public"]["Enums"]["wa_message_type"]
        }
        Insert: {
          body?: string
          bot_processed_at?: string | null
          contact_id: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["wa_message_direction"]
          external_id?: string
          id?: string
          media_mime?: string
          media_name?: string
          media_url?: string
          metadata?: Json
          sender_user_id?: string | null
          status?: Database["public"]["Enums"]["wa_message_status"]
          tenant_id: string
          type?: Database["public"]["Enums"]["wa_message_type"]
        }
        Update: {
          body?: string
          bot_processed_at?: string | null
          contact_id?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["wa_message_direction"]
          external_id?: string
          id?: string
          media_mime?: string
          media_name?: string
          media_url?: string
          metadata?: Json
          sender_user_id?: string | null
          status?: Database["public"]["Enums"]["wa_message_status"]
          tenant_id?: string
          type?: Database["public"]["Enums"]["wa_message_type"]
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_provider_config: {
        Row: {
          bridge_url: string
          created_at: string
          display_name: string
          evolution_api_key: string
          evolution_api_url: string
          evolution_instance_name: string
          id: string
          last_connected_at: string | null
          last_event_at: string | null
          last_qr_at: string | null
          meta_access_token: string
          meta_phone_number_id: string
          phone_number: string
          provider: Database["public"]["Enums"]["wa_provider_kind"]
          qr_code: string
          status: Database["public"]["Enums"]["wa_connection_status"]
          status_message: string
          tenant_id: string
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          bridge_url?: string
          created_at?: string
          display_name?: string
          evolution_api_key?: string
          evolution_api_url?: string
          evolution_instance_name?: string
          id?: string
          last_connected_at?: string | null
          last_event_at?: string | null
          last_qr_at?: string | null
          meta_access_token?: string
          meta_phone_number_id?: string
          phone_number?: string
          provider?: Database["public"]["Enums"]["wa_provider_kind"]
          qr_code?: string
          status?: Database["public"]["Enums"]["wa_connection_status"]
          status_message?: string
          tenant_id: string
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          bridge_url?: string
          created_at?: string
          display_name?: string
          evolution_api_key?: string
          evolution_api_url?: string
          evolution_instance_name?: string
          id?: string
          last_connected_at?: string | null
          last_event_at?: string | null
          last_qr_at?: string | null
          meta_access_token?: string
          meta_phone_number_id?: string
          phone_number?: string
          provider?: Database["public"]["Enums"]["wa_provider_kind"]
          qr_code?: string
          status?: Database["public"]["Enums"]["wa_connection_status"]
          status_message?: string
          tenant_id?: string
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      wa_webhook_events: {
        Row: {
          created_at: string
          error: string
          event_type: string
          id: string
          payload: Json
          processed: boolean
          provider: Database["public"]["Enums"]["wa_provider_kind"]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          error?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          provider: Database["public"]["Enums"]["wa_provider_kind"]
          tenant_id: string
        }
        Update: {
          created_at?: string
          error?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          provider?: Database["public"]["Enums"]["wa_provider_kind"]
          tenant_id?: string
        }
        Relationships: []
      }
      work_links: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string
          icon_url: string
          id: string
          name: string
          position: number
          tenant_id: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string
          icon_url?: string
          id?: string
          name: string
          position?: number
          tenant_id: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string
          icon_url?: string
          id?: string
          name?: string
          position?: number
          tenant_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      xml_consulta_lock: {
        Row: {
          acquired_at: string
          cnpj: string
          empresa_id: string | null
          expires_at: string
          owner: string | null
          tenant_id: string
        }
        Insert: {
          acquired_at?: string
          cnpj: string
          empresa_id?: string | null
          expires_at: string
          owner?: string | null
          tenant_id: string
        }
        Update: {
          acquired_at?: string
          cnpj?: string
          empresa_id?: string | null
          expires_at?: string
          owner?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xml_consulta_lock_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "xml_empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xml_consulta_lock_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      xml_consulta_logs: {
        Row: {
          acao: string
          bloqueado_ate: string | null
          created_at: string
          cstat: string | null
          empresa_id: string | null
          error: string | null
          id: string
          mensagem: string | null
          nsu_final: string | null
          nsu_inicial: string | null
          qtd_documentos: number | null
          status: string
          tenant_id: string
          tipo_consulta: string | null
          user_id: string | null
          xmotivo: string | null
        }
        Insert: {
          acao: string
          bloqueado_ate?: string | null
          created_at?: string
          cstat?: string | null
          empresa_id?: string | null
          error?: string | null
          id?: string
          mensagem?: string | null
          nsu_final?: string | null
          nsu_inicial?: string | null
          qtd_documentos?: number | null
          status: string
          tenant_id: string
          tipo_consulta?: string | null
          user_id?: string | null
          xmotivo?: string | null
        }
        Update: {
          acao?: string
          bloqueado_ate?: string | null
          created_at?: string
          cstat?: string | null
          empresa_id?: string | null
          error?: string | null
          id?: string
          mensagem?: string | null
          nsu_final?: string | null
          nsu_inicial?: string | null
          qtd_documentos?: number | null
          status?: string
          tenant_id?: string
          tipo_consulta?: string | null
          user_id?: string | null
          xmotivo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "xml_consulta_logs_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "xml_empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xml_consulta_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      xml_documentos: {
        Row: {
          chave_acesso: string
          cnpj_destinatario: string | null
          cnpj_emitente: string | null
          created_at: string
          data_emissao: string | null
          empresa_id: string
          id: string
          manifestado: boolean
          modelo: string | null
          nome_destinatario: string | null
          nome_emitente: string | null
          nsu: string | null
          numero: string | null
          origem: string
          serie: string | null
          situacao: string | null
          status_xml: string
          storage_path: string | null
          tenant_id: string
          tipo_documento: string
          ultima_atualizacao: string
          updated_at: string
          valor_total: number | null
          xml_completo: string | null
          xml_resumo: string | null
        }
        Insert: {
          chave_acesso: string
          cnpj_destinatario?: string | null
          cnpj_emitente?: string | null
          created_at?: string
          data_emissao?: string | null
          empresa_id: string
          id?: string
          manifestado?: boolean
          modelo?: string | null
          nome_destinatario?: string | null
          nome_emitente?: string | null
          nsu?: string | null
          numero?: string | null
          origem?: string
          serie?: string | null
          situacao?: string | null
          status_xml?: string
          storage_path?: string | null
          tenant_id: string
          tipo_documento?: string
          ultima_atualizacao?: string
          updated_at?: string
          valor_total?: number | null
          xml_completo?: string | null
          xml_resumo?: string | null
        }
        Update: {
          chave_acesso?: string
          cnpj_destinatario?: string | null
          cnpj_emitente?: string | null
          created_at?: string
          data_emissao?: string | null
          empresa_id?: string
          id?: string
          manifestado?: boolean
          modelo?: string | null
          nome_destinatario?: string | null
          nome_emitente?: string | null
          nsu?: string | null
          numero?: string | null
          origem?: string
          serie?: string | null
          situacao?: string | null
          status_xml?: string
          storage_path?: string | null
          tenant_id?: string
          tipo_documento?: string
          ultima_atualizacao?: string
          updated_at?: string
          valor_total?: number | null
          xml_completo?: string | null
          xml_resumo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "xml_documentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "xml_empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xml_documentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      xml_empresas: {
        Row: {
          agendamento_noturno: boolean
          bloqueado_ate: string | null
          certificado_id: string | null
          certificado_path: string | null
          cnpj: string
          codigo_interno: string | null
          codigo_jb: string | null
          cooldown_until: string | null
          created_at: string
          created_by: string | null
          data_ultima_consulta_cte: string | null
          data_ultima_consulta_nfe: string | null
          id: string
          inscricao_estadual: string | null
          last_error: string | null
          motivo_bloqueio: string | null
          nfeio_company_id: string | null
          nome_fantasia: string | null
          razao_social: string
          senha_cifrada: string | null
          status: string
          tenant_id: string
          uf: string | null
          ultima_consulta_at: string | null
          ultimo_nsu: string | null
          ultimo_nsu_cte: string | null
          ultimo_nsu_nfe: string | null
          updated_at: string
        }
        Insert: {
          agendamento_noturno?: boolean
          bloqueado_ate?: string | null
          certificado_id?: string | null
          certificado_path?: string | null
          cnpj: string
          codigo_interno?: string | null
          codigo_jb?: string | null
          cooldown_until?: string | null
          created_at?: string
          created_by?: string | null
          data_ultima_consulta_cte?: string | null
          data_ultima_consulta_nfe?: string | null
          id?: string
          inscricao_estadual?: string | null
          last_error?: string | null
          motivo_bloqueio?: string | null
          nfeio_company_id?: string | null
          nome_fantasia?: string | null
          razao_social: string
          senha_cifrada?: string | null
          status?: string
          tenant_id: string
          uf?: string | null
          ultima_consulta_at?: string | null
          ultimo_nsu?: string | null
          ultimo_nsu_cte?: string | null
          ultimo_nsu_nfe?: string | null
          updated_at?: string
        }
        Update: {
          agendamento_noturno?: boolean
          bloqueado_ate?: string | null
          certificado_id?: string | null
          certificado_path?: string | null
          cnpj?: string
          codigo_interno?: string | null
          codigo_jb?: string | null
          cooldown_until?: string | null
          created_at?: string
          created_by?: string | null
          data_ultima_consulta_cte?: string | null
          data_ultima_consulta_nfe?: string | null
          id?: string
          inscricao_estadual?: string | null
          last_error?: string | null
          motivo_bloqueio?: string | null
          nfeio_company_id?: string | null
          nome_fantasia?: string | null
          razao_social?: string
          senha_cifrada?: string | null
          status?: string
          tenant_id?: string
          uf?: string | null
          ultima_consulta_at?: string | null
          ultimo_nsu?: string | null
          ultimo_nsu_cte?: string | null
          ultimo_nsu_nfe?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "xml_empresas_certificado_fk"
            columns: ["certificado_id"]
            isOneToOne: false
            referencedRelation: "digital_certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xml_empresas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      xml_manifestacoes: {
        Row: {
          created_at: string
          created_by: string | null
          data_manifestacao: string
          documento_id: string
          id: string
          mensagem: string | null
          protocolo: string | null
          status: string | null
          tenant_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_manifestacao?: string
          documento_id: string
          id?: string
          mensagem?: string | null
          protocolo?: string | null
          status?: string | null
          tenant_id: string
          tipo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_manifestacao?: string
          documento_id?: string
          id?: string
          mensagem?: string | null
          protocolo?: string | null
          status?: string | null
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "xml_manifestacoes_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "xml_documentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xml_manifestacoes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      xml_user_permissions: {
        Row: {
          created_at: string
          id: string
          permission: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xml_user_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_overdue_invoices: {
        Args: { _tolerance_days?: number }
        Returns: Json
      }
      check_tenant_quota: {
        Args: { _counter_key: string; _increment?: number; _tenant_id: string }
        Returns: Json
      }
      current_user_department_id: { Args: never; Returns: string }
      current_user_tenant_ids: { Args: never; Returns: string[] }
      generate_invoice_for_tenant: {
        Args: { _ref_month?: string; _tenant_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_admin_or_supervisor: { Args: { _user_id: string }; Returns: boolean }
      is_admin_or_ti: { Args: { _user_id: string }; Returns: boolean }
      is_chat_participant: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      map_task_status_to_ticket: { Args: { _status: string }; Returns: string }
      map_ticket_status_to_task: { Args: { _status: string }; Returns: string }
      map_ticket_urgency_to_task: { Args: { _urg: string }; Returns: string }
      mark_invoice_paid: {
        Args: { _invoice_id: string; _method?: string; _receipt?: string }
        Returns: Json
      }
      next_billing_date: {
        Args: { _day?: number; _from: string }
        Returns: string
      }
      ticket_status_label: { Args: { _status: string }; Returns: string }
      user_belongs_to_tenant: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      user_is_tenant_admin: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      xml_has_permission: {
        Args: { _perm: string; _tenant_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "supervisor" | "user"
      chat_conversation_type: "dm" | "group"
      chat_message_type: "text" | "image" | "video" | "file"
      chat_presence_status: "online" | "offline" | "busy" | "away" | "invisible"
      chatbot_node_kind:
        | "start"
        | "message"
        | "question"
        | "condition"
        | "action"
        | "handoff"
        | "end"
        | "menu"
      chatbot_trigger_kind:
        | "any_message"
        | "keyword"
        | "first_contact"
        | "manual"
      invitation_status: "pending" | "accepted" | "revoked" | "expired"
      ramal_status: "ativo" | "manutencao" | "inativo"
      subscription_status: "active" | "past_due" | "canceled" | "trialing"
      tenant_member_role: "owner" | "admin" | "member"
      tenant_status: "active" | "suspended" | "inactive" | "trial"
      ticket_status:
        | "aberto"
        | "em_andamento"
        | "finalizado"
        | "em_atendimento"
        | "aguardando"
        | "resolvido"
        | "fechado"
        | "cancelado"
      urgency_level: "baixa" | "media" | "alta" | "critica"
      wa_connection_status:
        | "disconnected"
        | "connecting"
        | "qr_required"
        | "connected"
        | "error"
      wa_conversation_status:
        | "novo"
        | "em_atendimento"
        | "aguardando_cliente"
        | "finalizado"
      wa_message_direction: "in" | "out"
      wa_message_status: "pending" | "sent" | "delivered" | "read" | "failed"
      wa_message_type:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "document"
        | "sticker"
        | "location"
        | "system"
      wa_provider_kind: "mock" | "baileys" | "meta_cloud" | "evolution"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "supervisor", "user"],
      chat_conversation_type: ["dm", "group"],
      chat_message_type: ["text", "image", "video", "file"],
      chat_presence_status: ["online", "offline", "busy", "away", "invisible"],
      chatbot_node_kind: [
        "start",
        "message",
        "question",
        "condition",
        "action",
        "handoff",
        "end",
        "menu",
      ],
      chatbot_trigger_kind: [
        "any_message",
        "keyword",
        "first_contact",
        "manual",
      ],
      invitation_status: ["pending", "accepted", "revoked", "expired"],
      ramal_status: ["ativo", "manutencao", "inativo"],
      subscription_status: ["active", "past_due", "canceled", "trialing"],
      tenant_member_role: ["owner", "admin", "member"],
      tenant_status: ["active", "suspended", "inactive", "trial"],
      ticket_status: [
        "aberto",
        "em_andamento",
        "finalizado",
        "em_atendimento",
        "aguardando",
        "resolvido",
        "fechado",
        "cancelado",
      ],
      urgency_level: ["baixa", "media", "alta", "critica"],
      wa_connection_status: [
        "disconnected",
        "connecting",
        "qr_required",
        "connected",
        "error",
      ],
      wa_conversation_status: [
        "novo",
        "em_atendimento",
        "aguardando_cliente",
        "finalizado",
      ],
      wa_message_direction: ["in", "out"],
      wa_message_status: ["pending", "sent", "delivered", "read", "failed"],
      wa_message_type: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "sticker",
        "location",
        "system",
      ],
      wa_provider_kind: ["mock", "baileys", "meta_cloud", "evolution"],
    },
  },
} as const
