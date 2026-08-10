import React from 'react';

/**
 * Minimal markdown renderer for reviewing generated reports.
 *
 * Builds React elements directly and never uses dangerouslySetInnerHTML — this
 * content comes from a model and, later, from inbound email, so it must not be
 * able to inject markup.
 */

const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  // **bold**, *italic*, `code`
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key} className="font-bold text-slate-900">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key} className="bg-slate-100 text-slate-800 rounded px-1 py-0.5 text-[0.9em] font-mono">{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={key} className="italic">{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

export const Markdown: React.FC<{ content: string }> = ({ content }) => {
  const lines = (content || '').split('\n');
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc pl-5 space-y-1 my-2 text-slate-700">
        {listBuffer.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}
      </ul>
    );
    listBuffer = [];
  };

  const flushCode = (key: string) => {
    if (codeBuffer.length === 0) return;
    blocks.push(
      <pre key={key} className="bg-slate-900 text-slate-100 rounded-xl p-3 my-3 text-xs font-mono overflow-x-auto">
        <code>{codeBuffer.join('\n')}</code>
      </pre>
    );
    codeBuffer = [];
  };

  lines.forEach((raw, idx) => {
    const key = `b${idx}`;

    if (raw.trim().startsWith('```')) {
      if (inCode) { flushCode(key); inCode = false; } else { flushList(key); inCode = true; }
      return;
    }
    if (inCode) { codeBuffer.push(raw); return; }

    const line = raw.trim();

    if (line === '') { flushList(key); return; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList(key);
      const level = heading[1].length;
      const size = level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-sm';
      blocks.push(
        <div key={key} className={`${size} font-black text-slate-900 mt-4 mb-1.5 first:mt-0`}>
          {renderInline(heading[2], key)}
        </div>
      );
      return;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) { listBuffer.push(bullet[1]); return; }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) { listBuffer.push(numbered[1]); return; }

    if (/^([-*_])\1{2,}$/.test(line)) {
      flushList(key);
      blocks.push(<hr key={key} className="border-slate-200 my-4" />);
      return;
    }

    flushList(key);
    blocks.push(<p key={key} className="text-slate-700 leading-relaxed my-2">{renderInline(line, key)}</p>);
  });

  flushList('tail-list');
  flushCode('tail-code');

  return <div className="text-sm">{blocks}</div>;
};
