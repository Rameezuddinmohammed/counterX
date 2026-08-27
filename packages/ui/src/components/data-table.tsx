import * as React from "react";
import { cn } from "../lib/utils";

/**
 * Render a cell value that has no custom `cell` renderer. Null/undefined become
 * an empty string, primitives are stringified directly, and objects/arrays are
 * JSON-serialized so they never render as the useless "[object Object]".
 */
function renderCellValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return "";
  }
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    default:
      // Objects/arrays/symbols/functions: serialize instead of falling back to
      // the useless "[object Object]" default stringification.
      try {
        return JSON.stringify(value) ?? "";
      } catch {
        return "";
      }
  }
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell?: (item: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

export interface DataTableProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  columns: DataTableColumn<T>[];
  data: T[];
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  emptyMessage = "No data available",
  onRowClick,
  className,
  ...props
}: DataTableProps<T>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--border)]",
        className
      )}
      {...props}
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-secondary)]">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--foreground-muted)]",
                    column.className
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-[var(--foreground-muted)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((item, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={cn(
                    "transition-colors hover:bg-[var(--surface-secondary)]",
                    onRowClick && "cursor-pointer"
                  )}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-4 py-3 text-sm text-[var(--foreground)]",
                        column.className
                      )}
                    >
                      {column.cell
                        ? column.cell(item)
                        : renderCellValue(item[column.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
