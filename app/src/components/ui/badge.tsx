import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-primary/10 text-primary",
      accent: "bg-accent/10 text-accent",
      success: "bg-success/10 text-success",
      warning: "bg-warning/15 text-warning",
      destructive: "bg-destructive/10 text-destructive",
      muted: "bg-muted text-muted-foreground"
    }
  },
  defaultVariants: { variant: "default" }
});

export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
