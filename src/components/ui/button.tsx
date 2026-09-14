import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §9. `primary` is the lime action — one per view. Everything else
 * is neutral by default; colour here is a signal, not decoration.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control",
    "text-caption font-medium leading-none select-none",
    "transition-colors duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:brightness-95",
        secondary:
          "bg-surface-2 text-foreground border border-border hover:border-border-strong hover:bg-surface-3",
        ghost: "text-foreground-secondary hover:bg-surface-2 hover:text-foreground",
        danger:
          "bg-danger-subtle text-danger-foreground border border-transparent hover:bg-danger hover:text-white",
        destructive: "bg-danger text-white hover:brightness-110",
        link: "text-foreground underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-7 px-2.5 gap-1.5 text-meta",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-sm",
        icon: "size-8 p-0",
        "icon-sm": "size-7 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { buttonVariants }
