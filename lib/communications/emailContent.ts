import { convert } from 'html-to-text';

const MAX_HTML = 1_000_000;

/** Outlook text_body may be Graph's short preview; its HTML contains the message. */
export const emailContent = (result: any): { content?: string; contentTruncated?: boolean } => {
  const html = result?.email?.sanitized_html;
  if (typeof html === 'string' && html.trim()) {
    return {
      content: convert(html.slice(0, MAX_HTML), { wordwrap: false,
        limits: { maxInputLength: MAX_HTML },
        selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] }),
      contentTruncated: html.length > MAX_HTML
    };
  }
  const text = result?.email?.text_body;
  return { content: typeof text === 'string' && text.length ? text : result?.content };
};
