
import React from 'react';

// Default mappings for the initial statuses
export const DEFAULT_STATUS_COLORS: Record<string, string> = {
  'Completed': '#dcfce7',
  'Started': '#dbeafe',
  'Ready': '#e0e7ff',
  'Needs preparation': '#fed7aa',
  'Submitted': '#fce7f3',
  'Held': '#fef9c3',
  'Not Complete': '#f1f5f9',
  'Not started': '#f1f5f9',
  'Abandoned': '#fee2e2'
};

export const getStatusColor = (status: string) => DEFAULT_STATUS_COLORS[status] || '#f1f5f9';

export const getStatusBorderColor = (status: string) => {
  const borders: Record<string, string> = {
    'Completed': '#22c55e',
    'Started': '#3b82f6',
    'Ready': '#6366f1',
    'Needs preparation': '#f97316',
    'Submitted': '#db2777',
    'Held': '#eab308',
    'Not Complete': '#94a3b8',
    'Not started': '#94a3b8',
    'Abandoned': '#ef4444'
  };
  return borders[status] || '#94a3b8';
};