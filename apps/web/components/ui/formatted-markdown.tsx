"use client";

import React, { useMemo } from "react";
import { ExternalLink } from "lucide-react";

interface FormattedMarkdownProps {
  content: string;
  className?: string;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Tokenize bold, links, and inline code:
  // Regex matches: [label](url), **bold**, `code`
  const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      // Markdown link
      parts.push(
        <a
          key={`link-${match.index}`}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-primary font-medium hover:underline underline-offset-2"
        >
          {match[2]}
          <ExternalLink className="h-2.5 w-2.5 inline shrink-0 opacity-70" />
        </a>
      );
    } else if (match[4]) {
      // Bold text
      parts.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-foreground">
          {match[4]}
        </strong>
      );
    } else if (match[5]) {
      // Inline code
      parts.push(
        <code
          key={`code-${match.index}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground"
        >
          {match[5]}
        </code>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export function FormattedMarkdown({ content, className = "" }: FormattedMarkdownProps) {
  const elements = useMemo(() => {
    if (!content) return null;

    const lines = content.split("\n");
    const blocks: React.ReactNode[] = [];

    let currentList: { indent: number; text: string }[] = [];
    let currentTable: string[] = [];

    function flushList() {
      if (currentList.length === 0) return;
      blocks.push(
        <ul key={`list-${blocks.length}`} className="my-2 space-y-1.5 pl-2">
          {currentList.map((item, idx) => {
            const isSubItem = item.indent > 0;
            return (
              <li
                key={idx}
                className={`flex items-start gap-2 text-xs leading-relaxed ${
                  isSubItem ? "ml-5 text-muted-foreground text-[11px]" : "text-foreground"
                }`}
              >
                <span
                  className={`select-none shrink-0 ${
                    isSubItem ? "text-muted-foreground text-[9px]" : "text-primary font-bold"
                  }`}
                >
                  {isSubItem ? "◦" : "•"}
                </span>
                <span className="flex-1">{renderInline(item.text)}</span>
              </li>
            );
          })}
        </ul>
      );
      currentList = [];
    }

    function flushTable() {
      if (currentTable.length === 0) return;
      const rows = currentTable.map((row) =>
        row
          .split("|")
          .map((cell) => cell.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
      );

      if (rows.length >= 2) {
        const headerRow = rows[0];
        const bodyRows = rows.slice(2); // Skip separator row (e.g. |---|---|)

        blocks.push(
          <div key={`table-${blocks.length}`} className="my-3 overflow-x-auto rounded border border-border">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-muted border-b border-border">
                <tr>
                  {headerRow?.map((h, hIdx) => (
                    <th key={hIdx} className="px-3 py-2 font-semibold text-foreground">
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bodyRows.map((r, rIdx) => (
                  <tr key={rIdx} className="hover:bg-muted/50">
                    {r.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5 text-foreground">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      currentTable = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (!trimmed) {
        flushList();
        flushTable();
        continue;
      }

      // Markdown Table row
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        flushList();
        currentTable.push(trimmed);
        continue;
      } else if (currentTable.length > 0) {
        flushTable();
      }

      // Markdown Headings
      if (trimmed.startsWith("### ")) {
        flushList();
        blocks.push(
          <h3
            key={`h3-${i}`}
            className="text-xs font-bold text-foreground mt-3.5 mb-1.5 pb-1 border-b border-border/50 tracking-tight"
          >
            {renderInline(trimmed.replace(/^###\s+/, ""))}
          </h3>
        );
        continue;
      }
      if (trimmed.startsWith("## ")) {
        flushList();
        blocks.push(
          <h2 key={`h2-${i}`} className="text-sm font-bold text-foreground mt-4 mb-2 tracking-tight">
            {renderInline(trimmed.replace(/^##\s+/, ""))}
          </h2>
        );
        continue;
      }
      if (trimmed.startsWith("# ")) {
        flushList();
        blocks.push(
          <h1 key={`h1-${i}`} className="text-base font-bold text-foreground mt-4 mb-2 tracking-tight">
            {renderInline(trimmed.replace(/^#\s+/, ""))}
          </h1>
        );
        continue;
      }

      // Markdown Lists (-, *, •)
      const listMatch = line.match(/^(\s*)(?:[-*•]|\d+\.)\s+(.+)$/);
      if (listMatch && listMatch[2]) {
        currentList.push({
          indent: (listMatch[1]?.length || 0) >= 2 ? 1 : 0,
          text: listMatch[2],
        });
        continue;
      } else if (currentList.length > 0) {
        flushList();
      }

      // Regular Paragraph
      blocks.push(
        <p key={`p-${i}`} className="text-xs text-foreground leading-relaxed my-1.5">
          {renderInline(trimmed)}
        </p>
      );
    }

    flushList();
    flushTable();

    return blocks;
  }, [content]);

  return <div className={`font-sans space-y-1 ${className}`}>{elements}</div>;
}

