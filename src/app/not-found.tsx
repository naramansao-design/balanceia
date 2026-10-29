import { t } from "@/i18n";
import Link from "next/link";
export default function NotFound() {
  return (
    <section className="narrow">
      <h1>{t.sceneNotFound}</h1>
      <Link className="primary" href="/">
        {t.choose}
      </Link>
    </section>
  );
}
