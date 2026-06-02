// Lista fixa de módulos liberáveis pelo SuperAdmin por tenant.
// Para adicionar um novo módulo: inclua aqui e proteja a navegação/rota usando o `key`.
import {
  KeyRound, BookOpen, Phone, FileSpreadsheet, FileCog, Briefcase, Headset, Landmark, FileCode2,
  type LucideIcon,
} from 'lucide-react';

export interface FeatureDefinition {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  defaultEnabled: boolean;
}

export const FEATURES: FeatureDefinition[] = [
  {
    key: 'work_links',
    label: 'Trabalho (Atalhos)',
    description: 'Painel de links rápidos para os sistemas externos da empresa.',
    icon: Briefcase,
    defaultEnabled: true,
  },
  {
    key: 'central_atendimento',
    label: 'Central de Atendimento (WhatsApp)',
    description: 'Atendimento de clientes via WhatsApp com conversas, tags, transferência e conversão em chamado.',
    icon: Headset,
    defaultEnabled: true,
  },
  {
    key: 'pdf_to_ofx',
    label: 'Conversor PDF → OFX',
    description: 'Converte extratos bancários em PDF para o formato OFX.',
    icon: FileSpreadsheet,
    defaultEnabled: true,
  },
  {
    key: 'document_converter',
    label: 'Conversor de Documentos',
    description: 'Converte entre PDF, Word, Excel, PowerPoint, imagens e mais.',
    icon: FileCog,
    defaultEnabled: true,
  },
  {
    key: 'password_vault',
    label: 'Cofre de Senhas',
    description: 'Armazenamento seguro de credenciais (apenas TI).',
    icon: KeyRound,
    defaultEnabled: true,
  },
  {
    key: 'knowledge_base',
    label: 'Base de Conhecimento',
    description: 'Artigos de FAQ e tutoriais internos.',
    icon: BookOpen,
    defaultEnabled: true,
  },
  {
    key: 'ramais',
    label: 'Ramais',
    description: 'Listagem de ramais telefônicos da equipe.',
    icon: Phone,
    defaultEnabled: true,
  },
  {
    key: 'bank_statement',
    label: 'Extrato Bancário',
    description: 'Importação, classificação e exportação de extratos bancários (OFX/CSV/XLSX) com regras automáticas.',
    icon: Landmark,
    defaultEnabled: true,
  },
  {
    key: 'consulta_xml',
    label: 'Consulta XML',
    description: 'Consulta, manifestação e download de XMLs fiscais (NF-e) via SEFAZ.',
    icon: FileCode2,
    defaultEnabled: true,
  },
];

export const FEATURE_KEYS = FEATURES.map(f => f.key);
