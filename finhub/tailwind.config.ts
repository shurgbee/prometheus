import type { Config } from "tailwindcss";

// Design tokens. Black-and-red bento theme. Contrast ratios are measured against `surface`.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#09090A", // page behind the tiles
        plane: "#1C1C1E", // inset boxes inside tiles
        surface: "#151516", // tiles
        raised: "#232325", // inputs, hovered rows, popovers
        overlay: "#2A2A2C",
        line: "rgba(255, 255, 255, 0.08)", // hairlines
        "line-strong": "rgba(255, 255, 255, 0.16)",
        ink: {
          DEFAULT: "#F6F4F4", // 17:1 on surface
          2: "#CFCBCB", // 11:1 on surface
          3: "#A09C9C", // 7:1 on surface, muted labels
        },
        accent: {
          DEFAULT: "#DC918A", // links and focus (7:1)
          strong: "#9E3F3B", // fills behind white text (6:1),
          ink: "#FFFFFF", // text on accent fills
        },
        brand: "#B04A45", // red fills and marks
        series: {
          cash: "#F6F4F4",
          cd: "#A3A3A6",
          stocks: "#B04A45",
        },
        up: "#3CCB7F",
        down: "#E0877F",
        status: {
          normal: "#F0A92B",
          critical: "#E07A72",
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
        DEFAULT: "12px",
        lg: "20px",
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
