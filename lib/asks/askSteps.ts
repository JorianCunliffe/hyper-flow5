import type { AskField, HumanAsk } from '../../types.js';

const responseValues = (ask: HumanAsk): Record<string, unknown> =>
  (ask.responses || []).reduce<Record<string, unknown>>((values, response) => ({
    ...values,
    ...(response.needsInterpretation ? {} : response.values || {})
  }), {});

export const pendingAskFields = (ask: HumanAsk): AskField[] => {
  const values = responseValues(ask);
  return (ask.fields || []).filter(field => {
    if (field.type === 'file') {
      return !(ask.responses || []).some(response =>
        !response.needsInterpretation && (response.attachments || []).some(attachment =>
          attachment.field === field.name || (!attachment.field && (ask.fields || []).filter(item => item.type === 'file').length === 1)
        )
      );
    }
    return values[field.name] === undefined || values[field.name] === null || values[field.name] === '';
  });
};

export const nextAskField = (ask: HumanAsk): AskField | undefined => pendingAskFields(ask)[0];

export const askFieldPrompt = (field: AskField): string => {
  const label = field.label || field.name.replace(/[_-]+/g, ' ');
  const options = field.options?.length ? ` Options: ${field.options.join(', ')}.` : '';
  const required = field.required === false ? ' You can reply SKIP.' : '';
  return `${label}?${options}${required}`;
};

export const askSchemaSummary = (ask: HumanAsk): string => {
  if (!(ask.fields || []).length) return '';
  return (ask.fields || []).map((field, index) => `${index + 1}. ${askFieldPrompt(field)}`).join('\n');
};

/** Maps a one-at-a-time SMS reply onto the field currently being asked. */
export const smsStepValues = (ask: HumanAsk, text: string | undefined): Record<string, unknown> | undefined => {
  const field = nextAskField(ask);
  const raw = text?.trim();
  if (!field || !raw) return undefined;
  if (field.required === false && raw.toLowerCase() === 'skip') return { [field.name]: null };
  if (field.type === 'file') return undefined;
  return { [field.name]: raw };
};
