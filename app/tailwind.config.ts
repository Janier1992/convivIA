import type { Config } from "tailwindcss";

const token = (name: string) => `hsl(var(--color-${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: token("primary"), foreground: token("primary-foreground") },
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
        secondary: { DEFAULT: token("secondary"), foreground: token("secondary-foreground") },
        success: { DEFAULT: token("success"), foreground: token("success-foreground") },
        warning: { DEFAULT: token("warning"), foreground: token("warning-foreground") },
        destructive: { DEFAULT: token("destructive"), foreground: token("destructive-foreground") },
        background: token("background"),
        foreground: token("foreground"),
        border: token("border"),
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        card: { DEFAULT: token("card"), foreground: token("card-foreground") }
      },
      borderRadius: {
        xl: "1rem",
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
