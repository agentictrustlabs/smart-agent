export interface FundingKindOption {
  id: string
  label: string
  description?: string
  ontologyTerm?: string
  category?: string
}

export const FUNDING_KIND_OPTIONS: FundingKindOption[] = [
  {
    id: 'trauma-care',
    label: 'Trauma care',
    ontologyTerm: 'intentType:TraumaCare',
    category: 'care',
  },
  {
    id: 'compassion-ministry',
    label: 'Compassion ministry',
    ontologyTerm: 'intentType:CompassionMinistry',
    category: 'care',
  },
  {
    id: 'migrant-family',
    label: 'Migrant family support',
    ontologyTerm: 'intentType:MigrantFamilySupport',
    category: 'care',
  },
  {
    id: 'coaching',
    label: 'Coaching',
    ontologyTerm: 'intentType:Coaching',
    category: 'formation',
  },
  {
    id: 'church-planting',
    label: 'Church planting',
    ontologyTerm: 'intentType:ChurchPlanting',
    category: 'mission',
  },
  {
    id: 'skills-training',
    label: 'Skills training',
    ontologyTerm: 'intentType:SkillsTraining',
    category: 'formation',
  },
  {
    id: 'education',
    label: 'Education',
    ontologyTerm: 'intentType:Education',
    category: 'formation',
  },
  {
    id: 'food-security',
    label: 'Food security',
    ontologyTerm: 'intentType:FoodSecurity',
    category: 'relief',
  },
  {
    id: 'housing',
    label: 'Housing',
    ontologyTerm: 'intentType:Housing',
    category: 'relief',
  },
  {
    id: 'legal-aid',
    label: 'Legal aid',
    ontologyTerm: 'intentType:LegalAid',
    category: 'care',
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    ontologyTerm: 'intentType:Healthcare',
    category: 'care',
  },
  {
    id: 'mental-health',
    label: 'Mental health',
    ontologyTerm: 'intentType:MentalHealth',
    category: 'care',
  },
  {
    id: 'children',
    label: 'Children',
    ontologyTerm: 'intentType:Children',
    category: 'care',
  },
  {
    id: 'elderly-care',
    label: 'Elderly care',
    ontologyTerm: 'intentType:ElderlyCare',
    category: 'care',
  },
  {
    id: 'disaster-relief',
    label: 'Disaster relief',
    ontologyTerm: 'intentType:DisasterRelief',
    category: 'relief',
  },
]

export function normalizeFundingKindId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
