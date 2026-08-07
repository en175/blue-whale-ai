import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        success: "#22c55e",
        accent: "#3b82f6",
      },
      fontFamily: {
        outfit: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      animation: {
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
      keyframes: {
        "caret-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
