import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

const controlClasses =
  "h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle aria-invalid:border-danger disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClasses, className)} {...props} />;
}

type FieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
};

/** A labelled input whose hint and error are announced by screen readers. */
export function Field({ label, hint, error, id, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const message = error ?? hint;
  const messageId = message ? `${inputId}-message` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {label}
      </label>
      <Input id={inputId} aria-invalid={error ? true : undefined} aria-describedby={messageId} {...props} />
      {message ? (
        <p id={messageId} className={cn("text-xs", error ? "text-danger" : "text-fg-muted")}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
