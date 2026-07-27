import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ConfirmProvider } from "@/components/confirm-dialog";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Haushaltsbudget",
  description: "Budget-, Ausgaben- und Vermögensübersicht für den privaten Haushalt",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="text/javascript"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var c=localStorage.getItem('theme');if(c==='dark')document.documentElement.classList.add('dark');}catch(e){}`,
          }}
        />
        {/* Anti-flash: restore color scheme before React hydrates */}
        <script
          type="text/javascript"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var c=localStorage.getItem('color-scheme');if(c)document.documentElement.setAttribute('data-color',c);}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <ConfirmProvider>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
