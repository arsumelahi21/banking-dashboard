"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

type DialogContentProps = ComponentProps<typeof RadixDialog.Content> & {
  title: string;
  description?: ReactNode;
  /** "modal" is centered, for confirmations. "sheet" slides from the side, for details. */
  layout?: "modal" | "sheet";
};

export function DialogContent({
  title,
  description,
  layout = "modal",
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <RadixDialog.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed z-50 overflow-y-auto bg-surface p-6 shadow-overlay",
          layout === "modal"
            ? "top-1/2 left-1/2 max-h-[85dvh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl"
            : "inset-y-0 right-0 w-full max-w-md border-l border-border",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <RadixDialog.Title className="text-base font-medium text-fg">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="text-sm text-fg-muted">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close
            aria-label="Close"
            className="-m-1 cursor-pointer rounded-md p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-5" aria-hidden />
          </RadixDialog.Close>
        </div>
        <div className="mt-5">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
