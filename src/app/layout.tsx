import { DemoSession } from "@/components/demo-session";
import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/config/brand";
import { t } from "@/i18n";
import "./globals.css";
export const metadata: Metadata = {
  title: brand.name,
  description: brand.slogan,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  const c = brand.colors;
  return (
    <html lang="pt-BR">
      <body
        style={
          {
            "--bg": c.background,
            "--surface": c.surface,
            "--pink": c.pink,
            "--purple": c.purple,
            "--orange": c.orange,
            "--text": c.text,
            "--muted": c.muted,
          } as React.CSSProperties
        }
      >
        <a className="skip" href="#main">
          {t.skip}
        </a>
        <header>
          <Link href="/" className="logo">
            <span className="logo-icon">↗</span>
            {brand.name}
            <span className="beta">BETA</span>
          </Link>
          <nav aria-label={t.navigation}>
            <Link href="/">{t.home}</Link>
            <Link href="/elenco">{t.cast}</Link>
            <Link href="/criacoes">{t.creations}</Link>
          </nav>
          <Link className="account" href="/conta">
            ◯ <span>{t.account}</span>
          </Link>
        </header>
        <div className="demo">
          <span /> {t.demo}
        </div>
        <DemoSession>
          <main id="main">{children}</main>
        </DemoSession>
        <footer>
          <Link className="logo" href="/">
            {brand.name}
          </Link>
          <span>{brand.slogan}</span>
          <small>{t.simulated}</small>
        </footer>
      </body>
    </html>
  );
}
