/**
 * Per-resource-type capacity-unit defaults.
 *
 * When `acceptMatch` mints an Entitlement, it pulls the capacity unit
 * + initial granted amount from this table based on the offering's
 * `resourceType`. The provider can override at offering-publication
 * time (via the offering's payload), but most matches just use the
 * default for the type.
 *
 * The `unit` values are SKOS concept URIs from
 * `docs/ontology/cbox/capacity-units.ttl`. The `defaultGranted` is a
 * sensible starting amount tuned to the catalyst demo's persona scale.
 */

export type CapacityUnit =
  | 'capacityUnit:HoursPerWeek'
  | 'capacityUnit:Dollars'
  | 'capacityUnit:Slots'
  | 'capacityUnit:Sessions'
  | 'capacityUnit:Introductions'
  | 'capacityUnit:Bookings'
  | 'capacityUnit:YesNo'
  | 'capacityUnit:Reports'

export interface CapacityDefault {
  unit: CapacityUnit
  /** Amount granted at mint time. The action layer can scale this if
   *  the offering's `payload.capacity` declares something different. */
  defaultGranted: number
  /** Default cadence — drives recurring work-item generation. */
  cadence: 'one-shot' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'on-demand'
  /** Default validity in days from validFrom. */
  defaultValidityDays: number
}

export const CAPACITY_DEFAULTS: Record<string, CapacityDefault> = {
  // Human / role-bearing offerings
  'resourceType:Worker':       { unit: 'capacityUnit:HoursPerWeek', defaultGranted: 10, cadence: 'weekly',    defaultValidityDays: 180 },
  'resourceType:Skill':        { unit: 'capacityUnit:HoursPerWeek', defaultGranted: 5,  cadence: 'weekly',    defaultValidityDays: 90  },
  'resourceType:Connector':    { unit: 'capacityUnit:Introductions', defaultGranted: 3,  cadence: 'on-demand', defaultValidityDays: 90  },

  // Material
  'resourceType:Money':        { unit: 'capacityUnit:Dollars',     defaultGranted: 5000, cadence: 'quarterly', defaultValidityDays: 365 },
  'resourceType:Venue':        { unit: 'capacityUnit:Bookings',    defaultGranted: 12,   cadence: 'monthly',   defaultValidityDays: 365 },

  // Spiritual
  'resourceType:Prayer':       { unit: 'capacityUnit:Slots',       defaultGranted: 26,   cadence: 'weekly',    defaultValidityDays: 180 },

  // Knowledge
  'resourceType:Data':         { unit: 'capacityUnit:YesNo',       defaultGranted: 1,    cadence: 'one-shot',  defaultValidityDays: 30  },
  'resourceType:Scripture':    { unit: 'capacityUnit:Sessions',    defaultGranted: 6,    cadence: 'weekly',    defaultValidityDays: 90  },
  'resourceType:Curriculum':   { unit: 'capacityUnit:Sessions',    defaultGranted: 8,    cadence: 'weekly',    defaultValidityDays: 90  },

  // Institutional
  'resourceType:Church':       { unit: 'capacityUnit:Sessions',    defaultGranted: 12,   cadence: 'weekly',    defaultValidityDays: 365 },
  'resourceType:Organization': { unit: 'capacityUnit:Reports',     defaultGranted: 4,    cadence: 'quarterly', defaultValidityDays: 365 },
  'resourceType:Credential':   { unit: 'capacityUnit:YesNo',       defaultGranted: 1,    cadence: 'one-shot',  defaultValidityDays: 365 },
}

const FALLBACK: CapacityDefault = {
  unit: 'capacityUnit:Sessions',
  defaultGranted: 4,
  cadence: 'weekly',
  defaultValidityDays: 180,
}

export function capacityDefaultFor(resourceType: string): CapacityDefault {
  return CAPACITY_DEFAULTS[resourceType] ?? FALLBACK
}

/** Friendly label for a capacity unit (UI). */
export const CAPACITY_UNIT_LABEL: Record<CapacityUnit, string> = {
  'capacityUnit:HoursPerWeek':   'hours / week',
  'capacityUnit:Dollars':        'dollars',
  'capacityUnit:Slots':          'slots',
  'capacityUnit:Sessions':       'sessions',
  'capacityUnit:Introductions':  'introductions',
  'capacityUnit:Bookings':       'bookings',
  'capacityUnit:YesNo':          '',
  'capacityUnit:Reports':        'reports',
}
