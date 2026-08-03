import React from 'react';

interface FormattedMarkdownProps {
  content: string;
}

export const FormattedMarkdown: React.FC<FormattedMarkdownProps> = ({ content }) => {
  if (!content) return null;

  // Split into lines to parse block elements
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];
  let tableKeyCounter = 0;

  const renderInlineStyles = (text: string): React.ReactNode[] => {
    // Helper to parse **bold**, *italic*, and `code`
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
    let lastIdx = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(text.substring(lastIdx, match.index));
      }
      const matchedStr = match[0];
      if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
        parts.push(
          <strong key={match.index} style={{ color: '#ffffff', fontWeight: 600 }}>
            {matchedStr.slice(2, -2)}
          </strong>
        );
      } else if (matchedStr.startsWith('*') && matchedStr.endsWith('*')) {
        parts.push(
          <em key={match.index} style={{ color: '#d1d5db', fontStyle: 'italic' }}>
            {matchedStr.slice(1, -1)}
          </em>
        );
      } else if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
        parts.push(
          <code
            key={match.index}
            style={{
              backgroundColor: 'rgba(6, 182, 212, 0.15)',
              color: '#38bdf8',
              padding: '2px 6px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '0.9em',
            }}
          >
            {matchedStr.slice(1, -1)}
          </code>
        );
      }
      lastIdx = regex.lastIndex;
    }

    if (lastIdx < text.length) {
      parts.push(text.substring(lastIdx));
    }

    return parts;
  };

  const flushTable = () => {
    if (tableHeader.length > 0) {
      elements.push(
        <div key={`table-${tableKeyCounter++}`} style={{ overflowX: 'auto', margin: '12px 0' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
              backgroundColor: 'rgba(17, 24, 39, 0.7)',
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: 'rgba(6, 182, 212, 0.15)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                {tableHeader.map((h, i) => (
                  <th key={i} style={{ padding: '8px 12px', textAlign: 'left', color: '#38bdf8', fontWeight: 600 }}>
                    {renderInlineStyles(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  style={{
                    backgroundColor: rIdx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                    borderBottom: rIdx < tableRows.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
                  }}
                >
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} style={{ padding: '8px 12px', color: '#d1d5db' }}>
                      {renderInlineStyles(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    inTable = false;
    tableHeader = [];
    tableRows = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check table line
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      
      // Divider line check like |---|---|
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        continue; // Skip divider row
      }

      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (!line) {
      elements.push(<div key={`sp-${i}`} style={{ height: '8px' }} />);
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} style={{ fontSize: '20px', fontWeight: 700, color: '#06b6d4', margin: '16px 0 8px 0', borderBottom: '1px solid rgba(6, 182, 212, 0.2)', paddingBottom: '6px' }}>
          {renderInlineStyles(line.replace('# ', ''))}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} style={{ fontSize: '17px', fontWeight: 700, color: '#38bdf8', margin: '14px 0 6px 0' }}>
          {renderInlineStyles(line.replace('## ', ''))}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} style={{ fontSize: '15px', fontWeight: 600, color: '#818cf8', margin: '12px 0 4px 0' }}>
          {renderInlineStyles(line.replace('### ', ''))}
        </h3>
      );
    } else if (line.startsWith('#### ')) {
      elements.push(
        <h4 key={i} style={{ fontSize: '14px', fontWeight: 600, color: '#e5e7eb', margin: '10px 0 4px 0' }}>
          {renderInlineStyles(line.replace('#### ', ''))}
        </h4>
      );
    }
    // Horizontal Rule
    else if (line === '---' || line === '***' || line === '___') {
      elements.push(
        <hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '16px 0' }} />
      );
    }
    // Blockquote
    else if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={i}
          style={{
            borderLeft: '3px solid #06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.08)',
            padding: '8px 14px',
            margin: '8px 0',
            borderRadius: '0 6px 6px 0',
            color: '#9ca3af',
            fontSize: '13px',
          }}
        >
          {renderInlineStyles(line.replace('> ', ''))}
        </blockquote>
      );
    }
    // Unordered List item
    else if (line.startsWith('* ') || line.startsWith('- ')) {
      const itemContent = line.substring(2);
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '4px 0', paddingLeft: '8px' }}>
          <span style={{ color: '#06b6d4', fontWeight: 'bold' }}>•</span>
          <div style={{ flex: 1 }}>{renderInlineStyles(itemContent)}</div>
        </div>
      );
    }
    // Ordered List item (1., 2., etc.)
    else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^\d+\./)?.[0] || '';
      const itemContent = line.replace(/^\d+\.\s/, '');
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '4px 0', paddingLeft: '8px' }}>
          <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: '13px', minWidth: '18px' }}>{num}</span>
          <div style={{ flex: 1 }}>{renderInlineStyles(itemContent)}</div>
        </div>
      );
    }
    // Regular paragraph
    else {
      elements.push(
        <p key={i} style={{ margin: '4px 0', lineHeight: '1.6' }}>
          {renderInlineStyles(line)}
        </p>
      );
    }
  }

  if (inTable) {
    flushTable();
  }

  return <div style={{ display: 'flex', flexDirection: 'column' }}>{elements}</div>;
};
