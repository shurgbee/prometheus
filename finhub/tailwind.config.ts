import type { Config } from "tailwindcss";

// Design tokens. Dark only. Contrast ratios are measured against `plane`/`surface`.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        plane: "#121213", // inset boxes inside panels
        surface: "#1B1816", // panels
        raised: "#24201D", // inputs, hovered rows, popovers
        overlay: "#2C2724",
        line: "rgba(237, 233, 228, 0.08)", // hairlines
        "line-strong": "rgba(237, 233, 228, 0.16)",
        ink: {
          DEFAULT: "#FDFBF8", // 17:1 on surface
          2: "#F0ECE6", // 15:1 on surface
          3: "#DAD5CE", // 12:1 on surface, muted labels
        },
        accent: {
          DEFAULT: "#7FA6F5", // links, focus, primary actions (7.8:1)
          strong: "#3987E5",
          ink: "#0E1A33", // text on accent fills
        },
        series: {
          cash: "#3987E5",
          cd: "#D95926",
          stocks: "#199E70",
        },
        up: "#2FB36A",
        down: "#E66767",
        status: {
          normal: "#FAB219",
          critical: "#D03B3B",
        },
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Manrope", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        dot: ["Doto", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Modular scale (1.2) around a 15px body.
        "2xs": ["11px", { lineHeight: "16px" }],
        xs: ["12px", { lineHeight: "18px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["15px", { lineHeight: "24px" }],
        lg: ["18px", { lineHeight: "26px" }],
        xl: ["22px", { lineHeight: "30px" }],
        "2xl": ["28px", { lineHeight: "34px" }],
        "3xl": ["36px", { lineHeight: "40px" }],
        hero: ["56px", { lineHeight: "60px", letterSpacing: "-0.015em" }],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px",
        pill: "999px",
      },
      keyframes: {
        "row-in": {
          "0%": { opacity: "0", transform: "translateY(-6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulse_ring: {
          "0%": { boxShadow: "0 0 0 0 rgba(208, 59, 59, 0.55)" },
          "100%": { boxShadow: "0 0 0 10px rgba(208, 59, 59, 0)" },
        },
        caret: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      animation: {
        "row-in": "row-in 380ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "pulse-ring": "pulse_ring 1.4s ease-out 3",
        caret: "caret 1s step-end infinite",
      },
    },
  },
  plugins: [],
};

export default config;
