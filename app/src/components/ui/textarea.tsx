import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return <textarea ref={ref} className={cn("input-base min-h-24 resize-y", className)} {...props} />;
  }
);
Textarea.displayName = "Textarea";
