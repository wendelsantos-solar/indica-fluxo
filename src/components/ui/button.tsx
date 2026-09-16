import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * DESIGN.md §9. `primary` is the monochrome action — one per view, the thing the
 * screen exists for. Everything else is neutral: `secondary` is a hairline,
 * `ghost` is text until hovered. Colour here is a signal, not decoration.
 */
const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control",
    "text-caption font-medium leading-none",
    "transition-[background-color,color,border-color,opacity] duration-[120ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
    "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40",
    "touch:min-h-9 [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-control hover:bg-primary-hover active:brightness-95",
        secondary:
          "border border-border text-foreground-secondary hover:border-border-strong hover:bg-hover hover:text-foreground",
        ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
        danger:
          "border border-border text-danger-foreground hover:border-danger/50 hover:bg-danger-subtle",
        /* Solid, and only inside the confirmation that states the consequence. */
        destructive: "bg-danger text-on-danger hover:brightness-110",
        link: "h-auto px-0 text-foreground underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 px-2 text-meta [&_svg]:size-3.5",
        sm: "h-7 px-2.5 [&_svg]:size-3.5",
        md: "h-8 px-3",
        lg: "h-9 px-3.5",
        icon: "size-8 p-0",
        "icon-sm": "size-7 p-0 [&_svg]:size-3.5",
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
      {loading && !asChild ? (
        // The label stays in the layout (invisible) so the button keeps its
        // width; the spinner sits on top of it. DESIGN.md §9.
        <>
          <span className="invisible inline-flex items-center gap-1.5">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="animate-spin" aria-hidden="true" />
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { buttonVariants }
