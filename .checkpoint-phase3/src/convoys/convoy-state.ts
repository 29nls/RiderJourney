export const CONVOY_STATUSES = ['draft', 'lobby', 'active', 'paused', 'completed', 'cancelled'] as const;
export type ConvoyStatus = (typeof CONVOY_STATUSES)[number];

export const CONVOY_TRANSITIONS: Record<ConvoyStatus, readonly ConvoyStatus[]> = {
  draft: ['lobby', 'cancelled'],
  lobby: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: ConvoyStatus, to: ConvoyStatus): boolean {
  return CONVOY_TRANSITIONS[from].includes(to);
}

export const ACTIVE_CONVOY_STATUSES: readonly ConvoyStatus[] = ['lobby', 'active', 'paused'];
