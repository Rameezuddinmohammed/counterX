"use client";

import * as React from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

export interface ToasterProps {
  position?:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "top-center"
    | "bottom-center";
  richColors?: boolean;
  expand?: boolean;
}

function Toaster({ position = "bottom-right", richColors = true, expand = false }: ToasterProps) {
  return (
    <SonnerToaster
      position={position}
      richColors={richColors}
      expand={expand}
      toastOptions={{
        classNames: {
          toast:
            "group border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-xl rounded-xl",
          description: "text-[var(--foreground-secondary)]",
          actionButton: "bg-[var(--brand-red)] text-white hover:bg-[var(--brand-red-dark)]",
          cancelButton: "bg-[var(--surface-secondary)] text-[var(--foreground-secondary)]",
        },
      }}
    />
  );
}

export { Toaster, toast };
