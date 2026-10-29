import Link from "next/link";
import { t } from "@/i18n";
import { Art } from "@/components/art";
import { Catalog } from "@/components/catalog";
export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <i /> {t.original}
          </span>
          <h1>
            {t.headline}
            <br />
            <em>{t.headlineAccent}</em>
          </h1>
          <p>{t.description}</p>
          <Link className="primary" href="#cenas">
            {t.choose}
            <span>↗</span>
          </Link>
          <div className="hero-note">
            <span>01 — 02 — 03</span> {t.heroSequence}
          </div>
        </div>
        <Link href="/cena/orbita-particular" className="hero-visual">
          <Art index={0} hero />
          <div className="hero-caption">
            <div>
              <span className="eyebrow">{t.heroCaption}</span>
              <h2>Órbita particular</h2>
              <span>{t.heroSubtitle}</span>
            </div>
            <span className="round-arrow">↗</span>
          </div>
        </Link>
      </section>
      <Catalog />
      <section className="how">
        <div>
          <span className="eyebrow">{t.simple}</span>
          <h2>{t.how}</h2>
          <p>{t.howText}</p>
        </div>
        <ol>
          {t.steps.map((s, i) => (
            <li key={s}>
              <span>0{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
