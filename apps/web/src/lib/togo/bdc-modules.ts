/**
 * Togo Revenue-Sharing Pilot — BDC Training Curriculum
 *
 * The Business Development Center (BDC) training program that entrepreneurs
 * must complete before and during revenue-sharing participation.
 */

export interface BdcModule {
  id: string
  name: string
  description: string
  hours: number
  sortOrder: number
  /** Required for wave graduation? */
  required: boolean
}

export const BDC_MODULES: BdcModule[] = [
  {
    id: 'bdc-01', name: 'Business Foundations',
    description: 'Basic accounting, business planning, and market analysis',
    hours: 16, sortOrder: 1, required: true,
  },
  {
    id: 'bdc-02', name: 'Financial Literacy',
    description: 'Cash flow management, pricing, and basic bookkeeping',
    hours: 12, sortOrder: 2, required: true,
  },
  {
    id: 'bdc-03', name: 'Marketing & Sales',
    description: 'Customer acquisition, branding, and sales techniques',
    hours: 8, sortOrder: 3, required: true,
  },
  {
    id: 'bdc-04', name: 'Operations Management',
    description: 'Inventory, supply chain, quality control',
    hours: 8, sortOrder: 4, required: true,
  },
  {
    id: 'bdc-05', name: 'Digital Skills',
    description: 'Mobile payments, digital record-keeping, social media',
    hours: 6, sortOrder: 5, required: false,
  },
  {
    id: 'bdc-06', name: 'Leadership & Team Management',
    description: 'Hiring, delegation, team development',
    hours: 6, sortOrder: 6, required: false,
  },
  {
    id: 'bdc-07', name: 'Revenue-Sharing Orientation',
    description: 'Understanding the revenue-sharing model, reporting requirements, graduation criteria',
    hours: 4, sortOrder: 7, required: true,
  },
  {
    id: 'bdc-08', name: 'Growth Planning',
    description: 'Scaling strategy, reinvestment, wave progression planning',
    hours: 6, sortOrder: 8, required: false,
  },
]

/** Total hours for all required modules */
export const REQUIRED_HOURS = BDC_MODULES.filter(m => m.required).reduce((sum, m) => sum + m.hours, 0)

/** Total hours for all modules */
export const TOTAL_HOURS = BDC_MODULES.reduce((sum, m) => sum + m.hours, 0)
