import type { Metadata } from "next";
import { Anton } from "next/font/google";
import "./globals.css";
import { RangeSliderSync } from "./components/RangeSliderSync";

// Chrome uses the system font (SF Pro on Apple) via --font-sans in globals.css.
// Anton stays loaded for the canvas/template display type.
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Sonotoolv2",
  description: "Create and export branded social media videos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${anton.variable} antialiased`}
        suppressHydrationWarning
      >
        <RangeSliderSync />
        {children}
      </body>
    </html>
  );
}
