import type { Metadata } from "next";
import "./globals.css";
import Navbar from '@/components/Navbar';

// No next/font/google: the app must build and run without public-internet access,
// so it uses the operating system's font stack (see globals.css).

export const metadata: Metadata = {
  title: "DEIE Labs — University of Ruhuna",
  description: "Inventory and equipment borrowing system of the Department of Electrical and Information Engineering",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-background text-foreground min-h-screen flex flex-col antialiased">
        <Navbar />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
