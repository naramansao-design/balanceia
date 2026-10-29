"use client";
import { useState, useEffect, useRef } from "react";
import { useDemo } from "./demo-session";
import Link from "next/link";
import { scenes } from "@/data/scenes";
import { t } from "@/i18n";
import { Art } from "./art";

export function Studio({
  view,
  initialScene,
}: {
  view: "create" | "cast" | "creations" | "account";
  initialScene?: string;
}) {
  const {
    session,
    setSession,
    terms,
    setTerms,
    cast,
    setCast,
    generations,
    setGenerations,
    urls,
  } = useDemo();
  const [step, setStep] = useState(1),
    [scene, setScene] = useState<string>(
      initialScene && scenes.some((s) => s.slug === initialScene)
        ? initialScene
        : scenes[0].slug,
    ),
    [consent, setConsent] = useState(false),
    [photo, setPhoto] = useState(""),
    [name, setName] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [fail, setFail] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const s = scenes.find((s) => s.slug === scene)!;
  async function upload(file?: File) {
    setError("");
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setError(t.photoRequired);
      return;
    }
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const valid =
      (file.type === "image/jpeg" &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255) ||
      (file.type === "image/png" &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)) ||
      (file.type === "image/webp" &&
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP");
    if (!valid) {
      setError(t.photoRequired);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new window.Image();
      img.src = url;
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      setError(t.photoRequired);
      return;
    }
    urls.current.push(url);
    setPhoto(url);
    setSelected("");
  }
  function addCharacter() {
    if (!photo || !consent || !name.trim()) {
      setError(t.photoRequired);
      return;
    }
    const c = {
      id: crypto.randomUUID(),
      name: name.trim(),
      url: photo,
      consentAt: new Date().toISOString(),
    };
    setCast([...cast, c]);
    setSelected(c.id);
    setName("");
    setError("");
  }
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/demo/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: scene, consent: true }),
      });
      if (!response.ok) throw Error();
      const { requestId } = await response.json();
      setGenerations((prev) => [
        { id: requestId, title: s.title, status: "waiting", failed: fail },
        ...prev,
      ]);
    } catch {
      setError(t.simulationError);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const login = (
    <div className="panel">
      <h2>{t.steps[1]}</h2>
      <p>{t.loginHint}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
        />
        {t.terms}
      </label>
      <p className="muted">{t.termsInfo}</p>
      <button
        className="primary"
        disabled={!terms}
        onClick={() => setSession(true)}
      >
        {t.login}
      </button>
    </div>
  );
  const photoForm = (
    <>
      <label className="upload">
        ＋ {t.upload}
        <small>{t.uploadHint}</small>
        <input
          aria-label={t.upload}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </label>
      {photo && (
        <div
          className="photo-preview"
          style={{ backgroundImage: "url(" + photo + ")" }}
          role="img"
          aria-label={t.selectedPhoto}
        />
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t.consent}
      </label>
      <p className="muted">{t.privacy}</p>
    </>
  );
  const results = (
    <div className="results" aria-live="polite">
      {generations.map((g) => (
        <article className="panel" key={g.id}>
          <span className="eyebrow">{t.simulated}</span>
          <h3>{g.title}</h3>
          <p>
            {g.status === "waiting"
              ? t.pending
              : g.status === "processing"
                ? t.processing
                : g.status === "failed"
                  ? t.error
                  : t.complete}
          </p>
          {["completed", "failed"].includes(g.status) && (
            <p>{g.status === "failed" ? t.failed : t.noVideo}</p>
          )}
        </article>
      ))}
    </div>
  );
  if (view === "account")
    return (
      <section className="narrow">
        <span className="eyebrow">{t.yourSpace}</span>
        <h1>{t.account}</h1>
        <div className="panel">
          <h2>{t.profile}</h2>
          <p>{t.notConnected}</p>
          <p>{t.balance}</p>
          <p>{t.ledger}</p>
          <button disabled>{t.disabled}</button>
          <label className="check">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
            />
            {t.terms}
          </label>
          <small>{t.termsInfo}</small>
        </div>
      </section>
    );
  if (view === "creations")
    return (
      <section className="narrow">
        <h1>{t.creations}</h1>
        {generations.length ? (
          results
        ) : (
          <div className="empty">
            <span>▷</span>
            <h2>{t.emptyCreations}</h2>
            <p>{t.demo}</p>
            <Link className="primary" href="/criar">
              {t.create} ↗
            </Link>
          </div>
        )}
      </section>
    );
  if (view === "cast")
    return (
      <section className="narrow">
        <h1>{t.cast}</h1>
        {!session ? (
          login
        ) : (
          <div className="panel">
            <h2>{t.emptyCast}</h2>
            {photoForm}
            <label>
              {t.name}
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="primary" onClick={addCharacter}>
              {t.add}
            </button>
            {cast.map((c) => (
              <article className="cast-item" key={c.id}>
                <div
                  className="avatar"
                  style={{ backgroundImage: "url(" + c.url + ")" }}
                />
                <div>
                  {c.name}
                  <small>
                    {t.temporaryConsent}{" "}
                    {new Date(c.consentAt).toLocaleString("pt-BR")}
                  </small>
                </div>
                <button
                  onClick={() => setCast(cast.filter((x) => x.id !== c.id))}
                >
                  {t.remove}
                </button>
              </article>
            ))}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    );
  return (
    <section className="studio">
      <span className="eyebrow">{t.studioIntro}</span>
      <h1>{t.create}</h1>
      <ol className="steps">
        {t.steps.map((label, i) => (
          <li className={step === i + 1 ? "current" : ""} key={label}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="studio-grid">
        <div className="panel">
          {step === 1 ? (
            <>
              <h2>{t.steps[0]}</h2>
              <div className="scene-options">
                {scenes.map((scene) => (
                  <button
                    aria-pressed={scene.slug === s.slug}
                    onClick={() => setScene(scene.slug)}
                    key={scene.slug}
                  >
                    {scene.title}
                    <small>
                      {scene.duration}s · {scene.credits} {t.credits} (
                      {t.example})
                    </small>
                  </button>
                ))}
              </div>
              <button className="primary" onClick={() => setStep(2)}>
                {t.next} →
              </button>
            </>
          ) : step === 2 ? (
            !session ? (
              login
            ) : (
              <>
                <h2>{t.steps[1]}</h2>
                {photoForm}
                <label>
                  {t.cast}
                  <select
                    value={selected}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      const c = cast.find((c) => c.id === e.target.value);
                      if (c) {
                        setPhoto(c.url);
                        setConsent(true);
                      }
                    }}
                  >
                    <option value="">{t.noCast}</option>
                    {cast.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.name}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                  />
                </label>
                <button
                  onClick={addCharacter}
                  disabled={!name.trim() || !photo || !consent}
                >
                  {t.add}
                </button>
                <button
                  className="primary"
                  disabled={!photo || !consent}
                  onClick={() => setStep(3)}
                >
                  {t.next} →
                </button>
              </>
            )
          ) : (
            <>
              <h2>{t.steps[2]}</h2>
              <p>
                {s.title} · {s.duration} {t.duration}
              </p>
              <p>{t.quality}</p>
              <p>
                {s.credits} {t.credits} · {t.examplePrice}
              </p>
              <p>
                {t.demo}. {t.noCharge}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={fail}
                  disabled={busy}
                  onChange={(e) => setFail(e.target.checked)}
                />
                {t.simulateFailure}
              </label>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void generate()}
              >
                {busy ? t.processing : t.simulate}
              </button>
              {results}
            </>
          )}
          {step > 1 && (
            <button
              className="back"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              ← {t.back}
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <aside>
          <Art index={s.art} />
          <h2>{s.title}</h2>
          <p>{s.description}</p>
          <p className="muted">{t.simulated}</p>
        </aside>
      </div>
    </section>
  );
}
